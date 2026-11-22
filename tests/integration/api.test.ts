// REST surface, auth, authorization and origin checks.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, deepMerge } from "@/shared";
import { Api, Sock, defaultZones, guest, hostOp, setupLobby, startActive, startEnv, type TestEnv } from "./helpers";

let env: TestEnv;
beforeEach(async () => {
  env = await startEnv();
});
afterEach(async () => {
  await env.close();
});

describe("auth", () => {
  it("guest → register → logout → login, with httpOnly cookie and consistent errors", async () => {
    const a = new Api(env.base);
    const res = await fetch(env.base + "/api/auth/guest", { method: "POST", headers: { origin: env.base, "content-type": "application/json" }, body: JSON.stringify({ displayName: "Sam" }) });
    const cookie = res.headers.getSetCookie()[0];
    expect(cookie).toMatch(/^jh_session=[\w-]{43};/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).not.toMatch(/Secure/i); // not production
    a.cookie = cookie.split(";")[0];

    expect((await a.req("GET", "/api/me")).body.user.username).toBeNull();
    expect((await a.req("POST", "/api/auth/register", { username: "Sam_1", password: "hunter22hunter" })).body.user.username).toBe("sam_1");
    expect((await a.req("POST", "/api/auth/register", { username: "other", password: "hunter22hunter" })).body.error.code).toBe("already_registered");
    await a.req("POST", "/api/auth/logout", {});
    expect((await a.req("GET", "/api/me")).status).toBe(401);
    expect((await a.req("POST", "/api/auth/login", { username: "sam_1", password: "wrong-password" })).status).toBe(401);
    const ok = await a.req("POST", "/api/auth/login", { username: "sam_1", password: "hunter22hunter" });
    expect(ok.status).toBe(200);
    expect((await a.req("GET", "/api/me")).body.user.displayName).toBe("Sam");

    const bad = await a.req("POST", "/api/auth/guest", { displayName: "" });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatchObject({ code: "invalid_body" });
  });

  it("refuses mutating requests from another origin and sockets from another origin", async () => {
    const a = await guest(env.base, "Ann");
    const r = await a.req("POST", "/api/groups", { name: "X", icon: "🎯" }, { origin: "https://evil.example" });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("bad_origin");
    // APP_ORIGIN is accepted too.
    expect((await a.req("POST", "/api/groups", { name: "X", icon: "🎯" }, { origin: "http://app.example" })).status).toBe(201);
    await expect(Sock.open(env.base, a.cookie, "https://evil.example")).rejects.toThrow(/403/);
    await expect(Sock.open(env.base, "jh_session=nope")).rejects.toThrow(/401/);
  });

  it("rate-limits auth attempts per IP", async () => {
    const a = new Api(env.base);
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await a.req("POST", "/api/auth/login", { username: "nobody", password: "x" })).status);
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes.slice(10)).toEqual([429, 429]);
  });
});

describe("groups", () => {
  it("join by code or invite token, password, max members, roles, regenerate codes", async () => {
    const owner = await guest(env.base, "Owner");
    const g = (await owner.req("POST", "/api/groups", { name: "Crew", icon: "🎯", password: "secret1", maxMembers: 3 })).body;
    expect(g.joinCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(g.inviteToken).toHaveLength(22);

    const b = await guest(env.base, "B");
    const preview = await b.req("GET", `/api/invite/${g.inviteToken}`);
    expect(preview.body).toMatchObject({ groupName: "Crew", needsPassword: true, memberCount: 1, alreadyMember: false });
    expect((await b.req("POST", "/api/groups/join", { codeOrToken: g.inviteToken })).body.error.code).toBe("wrong_password");
    expect((await b.req("POST", "/api/groups/join", { codeOrToken: g.inviteToken, password: "secret1" })).body.myRole).toBe("member");
    const c = await guest(env.base, "C");
    // Lower-case and hyphenated codes are accepted.
    const code = `${g.joinCode.slice(0, 4)}-${g.joinCode.slice(4)}`.toLowerCase();
    expect((await c.req("POST", "/api/groups/join", { codeOrToken: code, password: "secret1" })).status).toBe(200);
    const d = await guest(env.base, "D");
    expect((await d.req("POST", "/api/groups/join", { codeOrToken: g.joinCode, password: "secret1" })).body.error.code).toBe("group_full");

    // Members don't see codes; owner promotes; admin can't remove the owner.
    const asMember = (await b.req("GET", `/api/groups/${g.id}`)).body;
    expect(asMember.joinCode).toBeNull();
    expect(asMember.members).toHaveLength(3);
    expect((await b.req("PUT", `/api/groups/${g.id}/members/${c.user!.id}`, { role: "admin" })).status).toBe(403);
    expect((await owner.req("PUT", `/api/groups/${g.id}/members/${b.user!.id}`, { role: "admin" })).body.role).toBe("admin");
    expect((await b.req("DELETE", `/api/groups/${g.id}/members/${owner.user!.id}`)).status).toBe(403);
    expect((await b.req("DELETE", `/api/groups/${g.id}/members/${c.user!.id}`)).status).toBe(200);

    const regen = (await b.req("POST", `/api/groups/${g.id}/regenerate-codes`, {})).body;
    expect(regen.joinCode).not.toBe(g.joinCode);
    expect((await d.req("POST", "/api/groups/join", { codeOrToken: g.inviteToken, password: "secret1" })).status).toBe(404);

    // Owner leaves: the admin inherits the group.
    await owner.req("POST", `/api/groups/${g.id}/leave`, {});
    expect((await b.req("GET", `/api/groups/${g.id}`)).body.myRole).toBe("owner");
  });

  it("brute-forcing join codes is rate-limited", async () => {
    const u = await guest(env.base, "U");
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await u.req("POST", "/api/groups/join", { codeOrToken: `ZZZZZZ${String(i).padStart(2, "0")}` })).status);
    expect(statuses.slice(0, 10).every((s) => s === 404)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it("presets CRUD + duplicate (managers only)", async () => {
    const owner = await guest(env.base, "Owner");
    const g = (await owner.req("POST", "/api/groups", { name: "Crew", icon: "🎯" })).body;
    const m = await guest(env.base, "M");
    await m.req("POST", "/api/groups/join", { codeOrToken: g.joinCode });
    const body = { kind: "game", name: "Fast", mode: "hide_seek", data: { settings: deepMerge(DEFAULT_SETTINGS, { timing: { durationMin: 10 } }) } };
    expect((await m.req("POST", `/api/groups/${g.id}/presets`, body)).status).toBe(403);
    const p = (await owner.req("POST", `/api/groups/${g.id}/presets`, body)).body;
    expect(p.data.settings.timing.durationMin).toBe(10);
    expect((await owner.req("PATCH", `/api/presets/${p.id}`, { data: { zones: defaultZones() } })).status).toBe(400);
    expect((await owner.req("PATCH", `/api/presets/${p.id}`, { name: "Faster" })).body.name).toBe("Faster");
    const dup = (await owner.req("POST", `/api/presets/${p.id}/duplicate`, {})).body;
    expect(dup.name).toBe("Faster copy");
    expect((await m.req("GET", `/api/groups/${g.id}/presets`)).body).toHaveLength(2);
    // A match from the saved preset uses its settings.
    const match = (await owner.req("POST", `/api/groups/${g.id}/matches`, { name: "From preset", presetId: p.id, zones: defaultZones() })).body;
    expect(match.settings.timing.durationMin).toBe(10);
    expect(match.state).toBe("draft");
    expect((await owner.req("DELETE", `/api/presets/${dup.id}`)).body.ok).toBe(true);
  });
});

describe("matches: authorization and settings", () => {
  it("non-members cannot read the group or match or open its socket; members cannot change settings", async () => {
    const s = await setupLobby(env, 2);
    const outsider = await guest(env.base, "Outsider");
    expect((await outsider.req("GET", `/api/groups/${s.groupId}`)).status).toBe(403);
    expect((await outsider.req("GET", `/api/matches/${s.matchId}`)).status).toBe(403);
    expect((await outsider.req("GET", `/api/groups/${s.groupId}/matches`)).status).toBe(403);
    const sock = await Sock.open(env.base, outsider.cookie);
    sock.send({ t: "hello", matchId: s.matchId });
    await sock.waitFor((f) => f.t === "error" && f.code === "forbidden");
    expect(sock.frames.some((f) => f.t === "view")).toBe(false);
    sock.send({ t: "ready", ready: true });
    await sock.waitFor((f) => f.t === "error" && f.code === "no_match");
    await sock.close();

    const member = s.users[1];
    const info = (await member.req("GET", `/api/matches/${s.matchId}`)).body;
    expect(info.canManage).toBe(false);
    expect((await member.req("PUT", `/api/matches/${s.matchId}/settings`, { settings: info.settings })).status).toBe(403);
    // Host ops from a member over WS are refused too.
    const id = "member-start-op";
    s.socks[1].send({ t: "host", opId: id, op: "start" });
    expect((await s.socks[1].ack(id)).error).toBe("forbidden");
  });

  it("a settings change resets every player's ready + consent and is broadcast", async () => {
    const s = await setupLobby(env, 2);
    const before = await s.socks[1].view((v) => !!v.me?.ready);
    expect(before.me?.consentValid).toBe(true);
    const from = s.socks[1].mark();
    const settings = deepMerge(before.settings, { timing: { durationMin: 45 } });
    const r = await s.users[0].req("PUT", `/api/matches/${s.matchId}/settings`, { settings });
    expect(r.status).toBe(200);
    expect(r.body.settingsHash).not.toBe(s.hash);
    const after = await s.socks[1].view((v) => v.settingsHash === r.body.settingsHash, from);
    expect(after.me?.ready).toBe(false);
    expect(after.me?.consentValid).toBe(false);
    expect(after.players.every((p) => !p.ready)).toBe(true);
    await s.socks[1].event("settings.changed", from);
    // Ready now requires fresh consent; the old hash is refused.
    s.socks[1].send({ t: "ready", ready: true });
    await s.socks[1].waitFor((f) => f.t === "error" && f.code === "consent_required", from);
    s.socks[1].send({ t: "consent", accept: true, settingsHash: s.hash });
    await s.socks[1].waitFor((f) => f.t === "error" && f.code === "stale_settings", from);

    // Invalid cross-field settings are refused with issues.
    const bad = await s.users[0].req("PUT", `/api/matches/${s.matchId}/settings`, { settings: deepMerge(settings, { capture: { methods: [] } }) });
    expect(bad.status).toBe(422);
    expect(bad.body.error.issues[0].key).toBe("issues.settings.noCaptureMethod");
    // Simulation is refused when the server does not allow it.
    expect((await s.users[0].req("PUT", `/api/matches/${s.matchId}/settings`, { settings: { ...settings, simulation: true } })).status).toBe(422);
  });

  it("start refuses while players are not ready, and only one open match per group", async () => {
    const s = await setupLobby(env, 2, {}, defaultZones(), { ready: false });
    const id = "start-op-unready";
    s.socks[0].send({ t: "host", opId: id, op: "start" });
    const ack = await s.socks[0].ack(id);
    expect(ack.ok).toBe(false);
    expect(ack.error).toBe("preflight_failed");
    expect(ack.issues?.some((i) => i.key === "issues.start.notReady")).toBe(true);
    expect(s.socks[0].lastView().state).toBe("lobby");
    const again = await s.users[0].req("POST", `/api/groups/${s.groupId}/matches`, { name: "Second" });
    expect(again.status).toBe(409);

    // Ending it lets the group create the next one, which archives the finished one.
    const endId = "end-op-0001";
    s.socks[0].send({ t: "host", opId: endId, op: "end" });
    expect((await s.socks[0].ack(endId)).ok).toBe(true);
    await s.socks[0].view((v) => v.state === "finished");
    const next = await s.users[0].req("POST", `/api/groups/${s.groupId}/matches`, { name: "Second", presetId: "classic" });
    expect(next.status).toBe(201);
    expect(next.body.settings.visibility.pings.intervalSec).toBe(300);
    const hist = (await s.users[1].req("GET", `/api/groups/${s.groupId}/matches`)).body;
    expect(hist[0]).toMatchObject({ id: s.matchId, state: "archived", result: { winner: "draw", reason: "cancelled" } });
    // Drafts are hidden from plain members.
    expect((await s.users[1].req("GET", `/api/matches/${next.body.id}`)).status).toBe(404);
    const me = (await s.users[1].req("GET", "/api/me")).body;
    expect(me.groups[0].activeMatch).toBeNull();
    expect((await s.users[0].req("GET", "/api/me")).body.activeMatches[0].state).toBe("draft");
  });

  it("real matches reject simulated fixes and bot ops", async () => {
    const s = await setupLobby(env, 2, { timing: { hidingSec: 0 } });
    const id = "bot-op-0001";
    s.socks[0].send({ t: "host", opId: id, op: "addBot" });
    expect((await s.socks[0].ack(id)).error).toBe("simulation_only");
    await startActive(env, s);
    const from = s.socks[1].mark();
    s.socks[1].send({ t: "loc", lat: 24.7136, lng: 46.6753, acc: 5, ts: 1, sim: true });
    await s.socks[1].waitFor((f) => f.t === "error" && f.code === "sim_not_allowed", from);
  });
});

describe("host rights follow the current group role", () => {
  it("an admin demoted or removed mid-match loses host ops without reconnecting", async () => {
    const s = await setupLobby(env, 3, {}, defaultZones(), { ready: false });
    const [owner, admin] = s.users;
    await owner.req("PUT", `/api/groups/${s.groupId}/members/${admin.user!.id}`, { role: "admin" });
    const sock = s.socks[1];
    // As admin: start is authorised (refused only by preflight).
    expect((await hostOp(sock, { op: "start" })).error).toBe("preflight_failed");
    await owner.req("PUT", `/api/groups/${s.groupId}/members/${admin.user!.id}`, { role: "member" });
    expect((await hostOp(sock, { op: "start" })).error).toBe("forbidden");
    await owner.req("PUT", `/api/groups/${s.groupId}/members/${admin.user!.id}`, { role: "admin" });
    expect((await hostOp(sock, { op: "start" })).error).toBe("preflight_failed");
    await owner.req("DELETE", `/api/groups/${s.groupId}/members/${admin.user!.id}`);
    expect((await hostOp(sock, { op: "start" })).error).toBe("forbidden");
  });
});
