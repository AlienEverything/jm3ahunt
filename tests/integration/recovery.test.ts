// Restart recovery and dev simulation bots.
import { afterEach, describe, expect, it } from "vitest";
import { Sock, hostOp, loc, setupLobby, startActive, startEnv, type TestEnv } from "./helpers";

const envs: TestEnv[] = [];
afterEach(async () => {
  for (const e of envs.splice(0)) await e.close().catch(() => undefined);
});

describe("restart recovery", () => {
  it("restores a live match from the snapshot with the same clock, roles and events, but no locations", async () => {
    const env = await startEnv();
    envs.push(env);
    const s = await setupLobby(env, 3, { timing: { hidingSec: 0, durationMin: 30 } });
    await startActive(env, s);
    s.socks[1].send(loc(24.7136, 46.6753));
    await s.socks[1].sync();
    const before = s.socks[1].lastView();
    const seqBefore = Math.max(...s.socks[1].events().map((e) => e.seq));
    await Promise.all(s.socks.map((k) => k.close()));
    await env.app.close();

    env.clock.t += 60_000;
    const env2 = await startEnv({ dbFile: env.dbFile, t: env.clock.t });
    envs.push(env2);
    const sock = await Sock.open(env2.base, s.users[1].cookie);
    sock.send({ t: "hello", matchId: s.matchId, lastSeq: 0 });
    const v = await sock.view();
    expect(v.state).toBe("active");
    expect(v.clock.endsAt).toBe(before.clock.endsAt);
    expect(v.reveal).toEqual(before.reveal);
    expect(v.me?.role).toBe(before.me?.role);
    expect(v.me?.consentValid).toBe(true);
    expect(v.locations).toEqual([]); // locations never survive a restart
    await sock.waitFor((f) => f.t === "event" && f.e.seq === seqBefore);
    expect(sock.events().map((e) => e.type)).toEqual(expect.arrayContaining(["match.started", "roles.assigned", "match.active"]));
    await sock.close();
  });

  it("finishes a match whose end passed while the server was down", async () => {
    const env = await startEnv();
    envs.push(env);
    const s = await setupLobby(env, 2, { timing: { hidingSec: 0, durationMin: 1 }, visibility: { pings: { enabled: false } } });
    await startActive(env, s);
    await Promise.all(s.socks.map((k) => k.close()));
    await env.app.close();
    const env2 = await startEnv({ dbFile: env.dbFile, t: env.clock.t + 5 * 60_000 });
    envs.push(env2);
    await env2.app.ctx.registry.flush();
    const api = s.users[0];
    const res = await fetch(env2.base + `/api/matches/${s.matchId}/results`, { headers: { cookie: api.cookie } });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.result).toMatchObject({ winner: "hiders", reason: "timeUp" });
  });
});

describe("dev simulation", () => {
  it("bots consent, wander inside the area and auto-accept tags; sim fixes are accepted", async () => {
    const env = await startEnv({ allowSim: true });
    envs.push(env);
    const s = await setupLobby(env, 1, { simulation: true, timing: { hidingSec: 0 }, roles: { assignment: "manual" }, capture: { methods: ["mutual"] }, visibility: { pings: { enabled: false }, hidersSeeHiders: true } });
    const host = s.socks[0];
    expect((await hostOp(host, { op: "addBot", count: 2 })).ok).toBe(true);
    const lobby = await host.view((v) => v.players.length === 3);
    const bots = lobby.players.filter((p) => p.userId !== s.users[0].user!.id);
    expect(bots.every((b) => b.ready)).toBe(true);
    await hostOp(host, { op: "setRole", userId: s.users[0].user!.id, role: "hider" });
    await hostOp(host, { op: "setRole", userId: bots[0].userId, role: "seeker" });
    await hostOp(host, { op: "setRole", userId: bots[1].userId, role: "hider" });
    await startActive(env, s);

    host.send({ ...loc(24.7136, 46.6753), sim: true });
    await host.sync();
    expect(host.frames.some((f) => f.t === "error" && f.code === "sim_not_allowed")).toBe(false);
    env.advance(9000);
    // Hiders see hiders here, so the hider bot's simulated position reaches the host.
    const v = await host.view((x) => x.locations.some((l) => l.userId === bots[1].userId));
    const botLoc = v.locations.find((l) => l.userId === bots[1].userId)!;
    expect(botLoc.kind).toBe("live");

    expect((await hostOp(host, { op: "removeBot", userId: bots[1].userId })).ok).toBe(true);
    await host.view((x) => x.players.find((p) => p.userId === bots[1].userId)?.status === "withdrawn");
  });

  it("a bot hider auto-accepts a tag after ~2 s", async () => {
    const env = await startEnv({ allowSim: true });
    envs.push(env);
    const s = await setupLobby(env, 1, { simulation: true, timing: { hidingSec: 0 }, roles: { assignment: "manual" }, capture: { methods: ["mutual"] } });
    const host = s.socks[0];
    await hostOp(host, { op: "addBot", count: 1 });
    const lobby = await host.view((v) => v.players.length === 2);
    const bot = lobby.players.find((p) => p.userId !== s.users[0].user!.id)!;
    await hostOp(host, { op: "setRole", userId: s.users[0].user!.id, role: "seeker" });
    await hostOp(host, { op: "setRole", userId: bot.userId, role: "hider" });
    await startActive(env, s);
    const id = "tag-bot-0001";
    host.send({ t: "tag", opId: id, hiderId: bot.userId });
    expect((await host.ack(id)).ok).toBe(true);
    env.advance(2000);
    await host.event("capture.confirmed");
    const done = await host.view((v) => v.state === "finished");
    expect(done.result?.winner).toBe("seekers");
  });
});
