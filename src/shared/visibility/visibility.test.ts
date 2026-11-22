import { describe, expect, it } from "vitest";
import { distanceM, toLngLat } from "../geo";
import { startClock } from "../match/clock";
import { seededRng } from "../match/roles";
import type { Settings } from "../schemas/settings";
import { CENTER, at, circle, fixAt, mainZone, settingsWith, zone } from "../test-helpers";
import type { LocationFix, MatchEvent, MatchState } from "../types";
import { approximate, buildView, eventVisibleTo, makeGridOffset, takePingSnapshot, type PingSnapshot, type ViewInput, type ViewPlayerInput } from ".";

const HASH = "a".repeat(64);
const NOW = 10_000_000;
const grid = makeGridOffset(CENTER[1], seededRng(5));

const player = (userId: string, role: ViewPlayerInput["role"], extra: Partial<ViewPlayerInput> = {}): ViewPlayerInput => ({
  userId,
  name: userId,
  avatar: { color: "#000000", emoji: "x" },
  role,
  team: role,
  status: "free",
  ready: true,
  consentHash: HASH,
  presence: "online",
  isHost: false,
  ...extra,
});

const players = [
  player("host", "seeker", { isHost: true }),
  player("s2", "seeker"),
  player("a", "hider"),
  player("b", "hider"),
  player("w", "hider", { status: "withdrawn" }),
  player("nc", "hider", { consentHash: null }),
  player("old", "hider", { consentHash: "b".repeat(64) }),
];

// Distinctive coordinates so any leak shows up in the serialized view.
const live: Record<string, LocationFix> = Object.fromEntries(
  players.map((p, i) => [p.userId, fixAt(at(100 + i * 137.31, 20 + i * 41), NOW - 2000, 6)]),
);
const HIDERS = ["a", "b", "w", "nc", "old"];

function input(over: Partial<ViewInput> & { state?: MatchState; settings?: Settings } = {}): ViewInput {
  const settings = over.settings ?? settingsWith();
  const clock = startClock(NOW - 400_000, settings); // active since NOW - 90 s
  return {
    match: { id: "m1", groupId: "g1", name: "Test", mode: "hide_seek", state: over.state ?? "active", settingsHash: HASH, version: 3 },
    now: NOW,
    clock,
    settings,
    zones: [mainZone(), zone("rescue", circle(at(200), 30), { id: "rescue", visibleTo: ["hider"] }), zone("safe", circle(at(400), 30), { id: "safe" })],
    players,
    live,
    pings: [],
    pendingCaptures: [],
    ...over,
  };
}

const leaks = (json: string, ids: string[]) =>
  ids.filter((id) => json.includes(String(live[id].lat)) || json.includes(String(live[id].lng)));

const ids = (v: ReturnType<typeof buildView>) => v.locations.map((l) => `${l.userId}:${l.kind}:${l.precision}`).sort();

describe("approximate", () => {
  it("true point is always inside the returned circle", () => {
    const rng = seededRng(11);
    for (let i = 0; i < 2000; i++) {
      const p = at(rng() * 30_000, rng() * 360);
      const r = 25 + rng() * 975;
      const a = approximate({ lng: p[0], lat: p[1] }, r, grid);
      expect(distanceM(p, [a.lng, a.lat])).toBeLessThanOrEqual(r);
      expect(a.radiusM).toBe(r);
    }
  });

  it("stationary point → identical circle; nearby points share a cell", () => {
    const p = { lng: at(321)[0], lat: at(321)[1] };
    expect(approximate(p, 150, grid)).toEqual(approximate({ ...p }, 150, grid));
    const q = toLngLat(p);
    const a = approximate(p, 150, grid);
    expect(distanceM(q, [a.lng, a.lat])).toBeGreaterThan(0); // not the raw point
  });

  it("grid offset differs per match", () => {
    const p = { lng: CENTER[0], lat: CENTER[1] };
    const g2 = makeGridOffset(CENTER[1], seededRng(99));
    expect(approximate(p, 150, grid)).not.toEqual(approximate(p, 150, g2));
  });
});

describe("buildView privacy", () => {
  it("seeker sees own + other seekers live, never a hider outside pings", () => {
    const v = buildView("s2", input());
    expect(ids(v)).toEqual(["host:live:exact", "s2:live:exact"]);
    expect(leaks(JSON.stringify(v), HIDERS)).toEqual([]);
  });

  it("scenario 5: host who plays seeker gets nothing extra", () => {
    const host = buildView("host", input());
    const plain = buildView("s2", input());
    expect(host.locations.map((l) => l.userId).sort()).toEqual(plain.locations.map((l) => l.userId).sort());
    expect(leaks(JSON.stringify(host), HIDERS)).toEqual([]);
    expect(host.me?.isHost).toBe(true);
  });

  it("hider sees only themself by default (no team sharing, no reciprocal pings)", () => {
    const v = buildView("a", input());
    expect(ids(v)).toEqual(["a:live:exact"]);
    expect(leaks(JSON.stringify(v), ["host", "s2", "b", "w", "nc", "old"])).toEqual([]);
  });

  it("hidersSeeHiders shares only consenting, still-playing hiders", () => {
    const v = buildView("a", input({ settings: settingsWith({ visibility: { hidersSeeHiders: true } }) }));
    expect(ids(v)).toEqual(["a:live:exact", "b:live:exact"]);
    expect(leaks(JSON.stringify(v), ["w", "nc", "old", "host", "s2"])).toEqual([]);
  });

  it("approx ping: seekers get grid circles, stale targets get 'no signal', raw coords never appear", () => {
    const settings = settingsWith();
    const staleLive = { ...live, b: { ...live.b, ts: NOW - 120_000 } };
    const snap = takePingSnapshot({ id: "p1", at: NOW, reason: "scheduled", audience: "seeker", players, settingsHash: HASH, live: staleLive, settings, grid });
    expect(snap.entries.map((e) => `${e.userId}:${e.precision}`).sort()).toEqual(["a:approx", "b:none"]);
    const v = buildView("s2", input({ live: staleLive, pings: [snap] }));
    const a = v.locations.find((l) => l.userId === "a");
    expect(a).toMatchObject({ kind: "ping", precision: "approx", radiusM: 150 });
    const b = v.locations.find((l) => l.userId === "b");
    expect(b).toEqual({ userId: "b", kind: "ping", precision: "none", noSignal: true, at: NOW, reason: "scheduled" });
    expect(leaks(JSON.stringify(v), HIDERS)).toEqual([]);
    // hiders never receive the seekers' snapshot
    expect(buildView("a", input({ pings: [snap] })).locations.map((l) => l.userId)).toEqual(["a"]);
  });

  it("exact ping and reciprocal pings follow settings", () => {
    const settings = settingsWith({ visibility: { pings: { precision: "exact", reciprocal: true } } });
    const toSeekers = takePingSnapshot({ id: "p1", at: NOW, reason: "scheduled", audience: "seeker", players, settingsHash: HASH, live, settings, grid });
    const toHiders = takePingSnapshot({ id: "p2", at: NOW, reason: "scheduled", audience: "hider", players, settingsHash: HASH, live, settings, grid });
    const sv = buildView("s2", input({ settings, pings: [toSeekers, toHiders] }));
    expect(sv.locations.find((l) => l.userId === "a")).toMatchObject({ precision: "exact", lat: live.a.lat });
    const hv = buildView("a", input({ settings, pings: [toSeekers, toHiders] }));
    expect(ids(hv)).toEqual(["a:live:exact", "host:ping:exact", "s2:ping:exact"]);
  });

  it("scenario 8: a player who withdrew after a ping vanishes from every later view", () => {
    const settings = settingsWith({ visibility: { pings: { precision: "exact" } } });
    const snap = takePingSnapshot({ id: "p1", at: NOW, reason: "scheduled", audience: "seeker", players, settingsHash: HASH, live, settings, grid });
    expect(snap.entries.some((e) => e.userId === "a")).toBe(true);
    const after = players.map((p) => (p.userId === "a" ? { ...p, status: "withdrawn" as const } : p));
    const { a: _gone, ...liveAfter } = live;
    const v = buildView("s2", input({ settings, players: after, live: liveAfter, pings: [snap] }));
    expect(v.locations.some((l) => l.userId === "a")).toBe(false);
    expect(leaks(JSON.stringify(v), HIDERS)).toEqual(["b"]); // b's exact ping is legitimate
    expect(leaks(JSON.stringify(v), ["a"])).toEqual([]);
    expect(v.players.find((p) => p.userId === "a")?.status).toBe("withdrawn");
    // the withdrawn player's own view stops too
    const own = buildView("a", input({ settings, players: after, live }));
    expect(own.locations).toEqual([]);
    expect(own.me?.tracking).toBe(false);
  });

  it("consent: a stale consent hash shares nothing and receives nothing", () => {
    const v = buildView("old", input({ settings: settingsWith({ visibility: { hidersSeeHiders: true } }) }));
    expect(v.locations).toEqual([]);
    expect(v.me).toMatchObject({ consentValid: false, tracking: false });
  });

  it("no locations outside tracking states", () => {
    for (const state of ["draft", "lobby", "preflight", "finished"] as const) {
      expect(buildView("s2", input({ state })).locations).toEqual([]);
    }
  });

  it("final reveal shows hiders live to seekers only in the last minutes", () => {
    const settings = settingsWith({ timing: { durationMin: 2 }, visibility: { pings: { finalRevealMin: 1 } } });
    const base = input({ settings });
    const early = buildView("s2", { ...base, now: base.clock.activeStartedAt! + 30_000 });
    expect(early.locations.some((l) => l.userId === "a")).toBe(false);
    const freshLive = Object.fromEntries(Object.entries(live).map(([k, f]) => [k, { ...f, ts: base.clock.endsAt! - 20_000 }]));
    const late = buildView("s2", { ...base, live: freshLive, now: base.clock.endsAt! - 10_000 });
    expect(ids(late)).toEqual(["a:live:exact", "b:live:exact", "host:live:exact", "s2:live:exact"]);
    expect(buildView("a", { ...base, live: freshLive, now: base.clock.endsAt! - 10_000 }).locations.map((l) => l.userId)).toEqual(["a"]);
  });

  it("boundary reveal is one exact entry for the opponents", () => {
    const settings = settingsWith();
    const snap: PingSnapshot = takePingSnapshot({
      id: "r1", at: NOW, reason: "boundary", audience: "seeker", players, settingsHash: HASH, live, settings, grid, targetIds: ["b"], precision: "exact",
    });
    const v = buildView("host", input({ pings: [snap] }));
    expect(v.locations.find((l) => l.userId === "b")).toMatchObject({ kind: "ping", precision: "exact", reason: "boundary" });
    expect(leaks(JSON.stringify(v), ["a", "w", "nc", "old"])).toEqual([]);
  });

  it("eliminated viewers receive nobody else's location", () => {
    const after = players.map((p) => (p.userId === "s2" ? { ...p, status: "eliminated" as const } : p));
    expect(ids(buildView("s2", input({ players: after })))).toEqual(["s2:live:exact"]);
  });

  it("zones are filtered by visibleTo; outsiders see only zones for everyone", () => {
    expect(buildView("s2", input()).zones.map((z) => z.id)).not.toContain("rescue");
    expect(buildView("a", input()).zones.map((z) => z.id)).toContain("rescue");
    const outsider = buildView("stranger", input());
    expect(outsider.me).toBeNull();
    expect(outsider.locations).toEqual([]);
    expect(outsider.zones.map((z) => z.id)).toEqual(["main", "safe"]);
  });

  it("me block, pending capture and next ping", () => {
    const pendingCaptures = [{ captureId: "c1", seekerId: "s2", hiderId: "a", expiresAt: NOW + 60_000, status: "pending" as const }];
    const v = buildView("a", input({ pendingCaptures }));
    expect(v.me).toMatchObject({ userId: "a", role: "hider", consentValid: true, tracking: true, boundary: { state: "ok" }, rescuesLeft: 0 });
    expect(v.pendingCapture?.captureId).toBe("c1");
    expect(buildView("b", input({ pendingCaptures })).pendingCapture).toBeUndefined();
    expect(v.nextPingAt).toBeGreaterThan(NOW);
    expect(v.clock.serverNow).toBe(NOW);
  });
});

describe("eventVisibleTo", () => {
  const e = (audience: MatchEvent["audience"]): MatchEvent => ({ seq: 1, type: "ping", at: 0, actorId: null, payload: {}, audience });
  it("filters by audience", () => {
    expect(eventVisibleTo(e("all"), { userId: "a", role: "hider" })).toBe(true);
    expect(eventVisibleTo(e("role:seeker"), { userId: "a", role: "hider" })).toBe(false);
    expect(eventVisibleTo(e("role:hider"), { userId: "a", role: "hider" })).toBe(true);
    expect(eventVisibleTo(e("user:a"), { userId: "a", role: null })).toBe(true);
    expect(eventVisibleTo(e("user:b"), { userId: "a", role: null })).toBe(false);
  });
});
