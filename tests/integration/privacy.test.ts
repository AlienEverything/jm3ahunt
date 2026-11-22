// Scenarios 2, 5 and 8: what coordinates reach which socket (inspects raw frames).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { destination, distanceM, type MatchView, type ViewLocation } from "@/shared";
import { CENTER, Sock, hostOp, loc, setupLobby, startActive, startEnv, type Setup, type TestEnv } from "./helpers";

let env: TestEnv;
beforeEach(async () => {
  env = await startEnv();
});
afterEach(async () => {
  await env.close();
});

/** Distinctive point per player and step so any leak shows up as an exact substring. */
const pointFor = (i: number, step: number) => destination(CENTER, 120 + i * 97.13 + step * 3.7, 15 + i * 61.7);

/** Every player sends a fix, then the clock moves 2.5 s. Returns all true fixes sent. */
async function walk(env: TestEnv, s: Setup, steps: number, step0 = 0) {
  const sent: Record<string, Array<[number, number]>> = {};
  for (let k = 0; k < steps; k++) {
    s.socks.forEach((sock, i) => {
      const [lng, lat] = pointFor(i, step0 + k);
      (sent[s.users[i].user!.id] ??= []).push([lat, lng]);
      sock.send(loc(lat, lng, 6));
    });
    await Promise.all(s.socks.map((x) => x.sync()));
    env.advance(2500, 2500);
  }
  return sent;
}

const leaks = (sock: Sock, coords: Array<[number, number]>) => coords.filter(([lat, lng]) => sock.raw.some((r) => r.includes(String(lat)) || r.includes(String(lng))));
const userIndex = (s: Setup, id: string) => s.users.findIndex((u) => u.user!.id === id);

describe("scenario 2: five players with approximate pings", () => {
  it("seekers only ever receive approximate ping circles for hiders, never true coordinates", async () => {
    const s = await setupLobby(env, 5, {
      timing: { countdownSec: 10, hidingSec: 30, durationMin: 30 },
      roles: { seekerCount: 2 },
      visibility: { seekersSeeSeekers: true, hidersSeeHiders: false, pings: { enabled: true, intervalSec: 60, firstPingAfterSec: 30, precision: "approx", approxRadiusM: 150 } },
    });
    await startActive(env, s);
    const v0 = s.socks[0].lastView();
    const seekers = v0.reveal!.seekerIds;
    const hiders = v0.players.filter((p) => p.role === "hider").map((p) => p.userId);
    expect(seekers).toHaveLength(2);
    expect(hiders).toHaveLength(3);

    const sent = await walk(env, s, 30); // 75 s of active play: one scheduled ping at 30 s
    const seekerSocks = seekers.map((id) => s.socks[userIndex(s, id)]);
    const hiderSocks = hiders.map((id) => s.socks[userIndex(s, id)]);

    for (const sk of seekerSocks) {
      for (const h of hiders) expect(leaks(sk, sent[h])).toEqual([]);
      const pinged = sk.frames.some((f) => f.t === "view" && f.v.locations.some((l) => l.kind === "ping" && l.precision === "approx"));
      expect(pinged).toBe(true);
      // Seekers see each other live (seekersSeeSeekers).
      const other = seekers.find((id) => id !== s.users[s.socks.indexOf(sk)].user!.id)!;
      expect(sk.lastView().locations.some((l) => l.userId === other && l.kind === "live")).toBe(true);
    }
    // Approx circles contain the true point at ping time and use the configured radius.
    const pingView = seekerSocks[0].frames.filter((f): f is { t: "view"; v: MatchView } => f.t === "view").map((f) => f.v).find((v) => v.locations.some((l) => l.kind === "ping"))!;
    for (const l of pingView.locations.filter((x): x is Extract<ViewLocation, { precision: "approx" }> => x.kind === "ping" && x.precision === "approx")) {
      expect(hiders).toContain(l.userId);
      expect(l.radiusM).toBe(150);
      const near = sent[l.userId].some(([lat, lng]) => distanceM([lng, lat], [l.lng, l.lat]) <= 150);
      expect(near).toBe(true);
    }
    // Hiders don't see other hiders (hidersSeeHiders off) and get no seeker pings (not reciprocal).
    for (const hk of hiderSocks) {
      const me = s.users[s.socks.indexOf(hk)].user!.id;
      for (const h of hiders.filter((x) => x !== me)) expect(leaks(hk, sent[h])).toEqual([]);
      for (const sk of seekers) expect(leaks(hk, sent[sk])).toEqual([]);
    }
    expect(seekerSocks[0].events().some((e) => e.type === "ping")).toBe(true);
    expect(hiderSocks[0].events().some((e) => e.type === "ping")).toBe(false);
  });
});

describe("scenario 5: host playing as seeker", () => {
  it("receives exactly what any other seeker receives: no hider coordinates", async () => {
    const s = await setupLobby(env, 3, { timing: { hidingSec: 0 }, roles: { assignment: "manual", seekerCount: 1 }, visibility: { pings: { enabled: false } } });
    const host = s.socks[0];
    const ids = s.users.map((u) => u.user!.id);
    expect((await hostOp(host, { op: "setRole", userId: ids[0], role: "seeker" })).ok).toBe(true);
    expect((await hostOp(host, { op: "setRole", userId: ids[1], role: "hider" })).ok).toBe(true);
    expect((await hostOp(host, { op: "setRole", userId: ids[2], role: "hider" })).ok).toBe(true);
    // Non-hosts cannot assign roles.
    expect((await hostOp(s.socks[1], { op: "setRole", userId: ids[1], role: "seeker" })).error).toBe("forbidden");
    await startActive(env, s);
    expect(host.lastView().me?.isHost).toBe(true);
    expect(host.lastView().me?.role).toBe("seeker");

    const sent = await walk(env, s, 10);
    expect(leaks(host, sent[ids[1]])).toEqual([]);
    expect(leaks(host, sent[ids[2]])).toEqual([]);
    for (const f of host.frames) {
      if (f.t !== "view") continue;
      expect(f.v.locations.every((l) => l.userId === ids[0])).toBe(true);
    }
  });
});

describe("scenario 8: withdrawing consent", () => {
  it("removes that player's coordinates from every later frame immediately", async () => {
    const s = await setupLobby(env, 3, { timing: { hidingSec: 0 }, roles: { assignment: "manual" }, visibility: { seekersSeeSeekers: true, pings: { enabled: false } } });
    const ids = s.users.map((u) => u.user!.id);
    await hostOp(s.socks[0], { op: "setRole", userId: ids[0], role: "seeker" });
    await hostOp(s.socks[0], { op: "setRole", userId: ids[1], role: "seeker" });
    await hostOp(s.socks[0], { op: "setRole", userId: ids[2], role: "hider" });
    await startActive(env, s);
    const [s1, s2] = s.socks;
    const sent = await walk(env, s, 3);
    await s1.view((v) => v.locations.some((l) => l.userId === ids[1]));

    await Promise.all([s1.sync(), s2.sync()]);
    const from1 = s1.mark();
    const from2 = s2.mark();
    s2.send({ t: "consent", accept: false });
    const after = await s1.view(() => true, from1);
    expect(after.locations.some((l) => l.userId === ids[1])).toBe(false);
    const own = await s2.view(() => true, from2);
    expect(own.locations).toEqual([]);
    expect(own.me?.tracking).toBe(false);
    expect(own.me?.consentValid).toBe(false);

    // Further fixes from s2 are refused, and nothing about s2 reaches s1 any more.
    const e2 = s2.mark();
    s2.send(loc(1, 1));
    await s2.waitFor((f) => f.t === "error" && f.code === "no_consent", e2);
    await walk(env, { ...s, socks: [s1, s.socks[2]], users: [s.users[0], s.users[2]] }, 3, 50);
    const later = s1.raw.slice(from1);
    for (const [lat, lng] of sent[ids[1]]) expect(later.some((r) => r.includes(String(lat)) || r.includes(String(lng)))).toBe(false);
    expect(s1.lastView().players.find((p) => p.userId === ids[1])).toBeTruthy(); // still a player, just not shared
  });
});
