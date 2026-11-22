// Scenario 1: two users, roles, countdown, confirmed mutual capture. Plus QR/code brute force and idempotent opIds.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { at, circle, mainZone, zone } from "@/shared/test-helpers";
import { action, hostOp, roleOf, setupLobby, startActive, startEnv, type TestEnv } from "./helpers";

let env: TestEnv;
beforeEach(async () => {
  env = await startEnv();
});
afterEach(async () => {
  await env.close();
});

describe("scenario 1: two players, countdown, mutual capture", () => {
  it("assigns roles at start, runs countdown → hiding → active, and confirms a mutual tag", async () => {
    const s = await setupLobby(env, 2, { timing: { countdownSec: 10, hidingSec: 60, durationMin: 30 }, capture: { methods: ["mutual"], outcome: "convert" } });
    const [a, b] = s.socks;
    const lobby = a.lastView();
    expect(lobby.state).toBe("lobby");
    expect(lobby.players.every((p) => p.role === null)).toBe(true); // nobody knows roles before start

    const start = await hostOp(a, { op: "start" });
    expect(start.ok).toBe(true);
    const cd = await b.view((v) => v.state === "countdown");
    expect(cd.reveal?.seekerIds).toHaveLength(1);
    expect(cd.reveal!.hops.length).toBeGreaterThanOrEqual(12);
    const seekerId = cd.reveal!.seekerIds[0];
    const [seeker, hider] = seekerId === s.users[0].user!.id ? [a, b] : [b, a];
    const hiderId = seekerId === s.users[0].user!.id ? s.users[1].user!.id : s.users[0].user!.id;
    expect(roleOf(cd, seekerId)).toBe("seeker");
    expect(roleOf(cd, hiderId)).toBe("hider");
    // Both phones get the same timeline.
    expect(a.lastView().clock.countdownEndsAt).toBe(cd.clock.countdownEndsAt);

    env.advance(10_000);
    await a.event("match.hiding");
    env.advance(60_000);
    await b.event("match.active");

    const from = hider.mark();
    const tag = await action(seeker, "tag", { hiderId });
    expect(tag.ok).toBe(true);
    const prompt = await hider.waitFor((f) => f.t === "prompt", from);
    if (prompt.t !== "prompt" || prompt.kind !== "tagRequest") throw new Error("expected tag prompt");
    // The seeker never gets the prompt.
    expect(seeker.frames.some((f) => f.t === "prompt")).toBe(false);

    const reply = await action(hider, "tagReply", { captureId: prompt.captureId, accept: true });
    expect(reply.ok).toBe(true);
    await seeker.event("capture.confirmed");
    await seeker.event("player.converted");
    const done = await seeker.view((v) => v.state === "finished");
    expect(done.result?.winner).toBe("seekers");
    expect(done.result?.reason).toBe("allCaught");
    expect(done.locations).toEqual([]);

    // Late duplicate reply is a no-op.
    const late = await action(hider, "tagReply", { captureId: prompt.captureId, accept: true });
    expect(late.ok).toBe(false);

    await env.app.ctx.registry.flush();
    const res = await s.users[0].req("GET", `/api/matches/${s.matchId}/results`);
    expect(res.status).toBe(200);
    expect(res.body.result.winner).toBe("seekers");
    expect(res.body.result.stats[seekerId].captures).toBe(1);
    expect(res.body.highlights.some((h: { type: string }) => h.type === "capture.confirmed")).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/"lat"|"lng"/);
    const me = await s.users[0].req("GET", "/api/me");
    expect(me.body.user.stats.matches).toBe(1);
  });

  it("a disputed tag waits for the host, who can confirm it", async () => {
    const s = await setupLobby(env, 3, { timing: { hidingSec: 0 }, capture: { methods: ["mutual"] }, roles: { seekerCount: 1 } });
    await startActive(env, s);
    const v = s.socks[0].lastView();
    const seekerId = v.reveal!.seekerIds[0];
    const idx = (id: string) => s.users.findIndex((u) => u.user!.id === id);
    const seeker = s.socks[idx(seekerId)];
    const hiderId = v.players.find((p) => p.role === "hider")!.userId;
    const hider = s.socks[idx(hiderId)];
    const from = hider.mark();
    expect((await action(seeker, "tag", { hiderId })).ok).toBe(true);
    const prompt = await hider.waitFor((f) => f.t === "prompt", from);
    if (prompt.t !== "prompt" || prompt.kind !== "tagRequest") throw new Error();
    await action(hider, "tagReply", { captureId: prompt.captureId, accept: false });
    await s.socks[0].event("capture.disputed");
    const host = s.socks[0];
    const notHost = s.socks.find((_, i) => i !== 0)!;
    expect((await hostOp(notHost, { op: "resolveCapture", captureId: prompt.captureId, decision: "confirm" })).error).toBe("forbidden");
    expect((await hostOp(host, { op: "resolveCapture", captureId: prompt.captureId, decision: "confirm" })).ok).toBe(true);
    await host.event("capture.confirmed");
  });
});

describe("QR and 6-digit code", () => {
  it("captures with a valid code, rate-limits brute force", async () => {
    const s = await setupLobby(env, 2, { timing: { hidingSec: 0 }, capture: { methods: ["qr", "code"], outcome: "convert" } });
    await startActive(env, s);
    const v = s.socks[0].lastView();
    const seekerId = v.reveal!.seekerIds[0];
    const [seeker, hider] = seekerId === s.users[0].user!.id ? [s.socks[0], s.socks[1]] : [s.socks[1], s.socks[0]];

    const from = hider.mark();
    hider.send({ t: "qrToken" });
    const qr = await hider.waitFor((f) => f.t === "qr", from);
    if (qr.t !== "qr") throw new Error();
    expect(qr.code).toMatch(/^\d{6}$/);
    // A seeker cannot ask for a token.
    const sf = seeker.mark();
    seeker.send({ t: "qrToken" });
    await seeker.waitFor((f) => f.t === "error" && f.code === "not_allowed", sf);

    const wrong = qr.code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 6; i++) expect((await action(seeker, "qrScan", { token: wrong })).error).toBe("invalid_token");
    // 7th attempt inside the minute is refused even with the right code.
    expect((await action(seeker, "qrScan", { token: qr.code })).error).toBe("rate_limited");
    // A forged QR token is rejected after the bucket refills.
    env.advance(20_000);
    const forged = qr.token.slice(0, -2) + (qr.token.endsWith("AA") ? "BB" : "AA");
    expect((await action(seeker, "qrScan", { token: forged })).error).toBe("invalid_token");
    // Codes rotate every 30 s: fetch a fresh one.
    const f2 = hider.mark();
    hider.send({ t: "qrToken" });
    const qr2 = await hider.waitFor((f) => f.t === "qr", f2);
    if (qr2.t !== "qr") throw new Error();
    expect((await action(seeker, "qrScan", { token: qr2.code })).ok).toBe(true);
    const done = await seeker.view((x) => x.state === "finished");
    expect(done.result?.winner).toBe("seekers");
  });

  it("repeated opIds are acked without re-applying", async () => {
    const s = await setupLobby(env, 3, { timing: { hidingSec: 0 }, capture: { methods: ["mutual"] } });
    await startActive(env, s);
    const v = s.socks[0].lastView();
    const seekerId = v.reveal!.seekerIds[0];
    const seeker = s.socks[s.users.findIndex((u) => u.user!.id === seekerId)];
    const hiderId = v.players.find((p) => p.role === "hider")!.userId;
    const from = seeker.mark();
    seeker.send({ t: "tag", opId: "dup-op-123", hiderId });
    seeker.send({ t: "tag", opId: "dup-op-123", hiderId });
    await seeker.sync();
    const acks = seeker.frames.slice(from).filter((f) => f.t === "ack" && f.opId === "dup-op-123");
    expect(acks).toHaveLength(2);
    expect(acks[0]).toEqual(acks[1]);
    expect(seeker.events().filter((e) => e.type === "capture.requested")).toHaveLength(1);
  });
});

describe("jail and rescue", () => {
  it("jails on capture, a free hider rescues with the jailed player's confirmation, timers release", async () => {
    const zones = [mainZone(1000), zone("jail", circle(at(200), 30), { id: "jail" })];
    const s = await setupLobby(env, 3, { timing: { hidingSec: 0 }, roles: { assignment: "manual" }, capture: { methods: ["mutual"], outcome: "jail" }, jail: { maxJailSec: 120, rescue: { enabled: true, method: "confirm", maxRescues: 1, cooldownSec: 0 } } }, zones);
    const [host, h1, h2] = s.socks;
    const [seekerId, h1Id, h2Id] = s.users.map((u) => u.user!.id);
    await hostOp(host, { op: "setRole", userId: seekerId, role: "seeker" });
    await hostOp(host, { op: "setRole", userId: h1Id, role: "hider" });
    await hostOp(host, { op: "setRole", userId: h2Id, role: "hider" });
    await startActive(env, s);

    const capture = async () => {
      const from = h1.mark();
      expect((await action(host, "tag", { hiderId: h1Id })).ok).toBe(true);
      const p = await h1.waitFor((f) => f.t === "prompt", from);
      if (p.t !== "prompt" || p.kind !== "tagRequest") throw new Error();
      await action(h1, "tagReply", { captureId: p.captureId, accept: true });
      return h1.view((v) => v.me?.status === "jailed", from);
    };
    const jailed = await capture();
    expect(jailed.me?.jailEndsAt).toBe(env.clock.t + 120_000);
    expect(host.lastView().state).toBe("active"); // one hider still free

    const from = h1.mark();
    expect((await action(h2, "rescue", { jailedId: h1Id })).ok).toBe(true);
    const rp = await h1.waitFor((f) => f.t === "prompt" && f.kind === "rescueRequest", from);
    if (rp.t !== "prompt" || rp.kind !== "rescueRequest") throw new Error();
    expect((await action(h1, "rescueReply", { rescuerId: h2Id, accept: true })).ok).toBe(true);
    await host.event("player.rescued", 0);
    expect((await h1.view((v) => v.me?.status === "free", from)).me?.status).toBe("free");
    expect((await h2.view((v) => v.me?.rescuesLeft === 0)).me?.rescuesLeft).toBe(0);

    // Second capture: no rescues left, the jail timer releases.
    await capture();
    expect((await action(h2, "rescue", { jailedId: h1Id })).error).toBe("noRescuesLeft");
    const f2 = host.mark();
    env.advance(121_000, 5000);
    await host.event("player.released", f2);
  });
});

describe("mutual tag requests leak nothing to the seeker", () => {
  it("same seeker frames for a far, a near and a safe-zone hider; the hint goes to the hider only", async () => {
    const safe = zone("safe", circle(at(400), 50), { id: "safe" });
    const s = await setupLobby(env, 4, { timing: { hidingSec: 0 }, roles: { assignment: "manual" }, capture: { methods: ["mutual"], proximity: "warn", maxTagDistanceM: 15 }, visibility: { pings: { enabled: false } } }, [mainZone(1000), safe]);
    const [seeker, far, near, inSafe] = s.socks;
    const [seekerId, farId, nearId, safeId] = s.users.map((u) => u.user!.id);
    await hostOp(seeker, { op: "setRole", userId: seekerId, role: "seeker" });
    for (const id of [farId, nearId, safeId]) await hostOp(seeker, { op: "setRole", userId: id, role: "hider" });
    await startActive(env, s);
    const put = async (sock: (typeof s.socks)[number], p: [number, number]) => {
      sock.send({ t: "loc", lat: p[1], lng: p[0], acc: 5, ts: 0 });
      await sock.sync();
    };
    await put(seeker, at(100));
    await put(near, at(100));
    await put(far, at(700, 270));
    await put(inSafe, at(400));

    const normalize = (frames: typeof seeker.frames) =>
      JSON.stringify(frames.filter((f) => f.t !== "hbAck"))
        .replace(/"(opId|captureId|hiderId|userId)":"[^"]+"/g, '"$1":"x"')
        .replace(/"(seq|at|serverNow)":\d+/g, '"$1":0');
    const seen: string[] = [];
    const prompts: Record<string, Extract<(typeof seeker.frames)[number], { t: "prompt" }>> = {};
    for (const [hiderSock, hiderId] of [[far, farId], [near, nearId], [inSafe, safeId]] as const) {
      await Promise.all(s.socks.map((k) => k.sync()));
      const from = seeker.mark();
      const hFrom = hiderSock.mark();
      const ack = await action(seeker, "tag", { hiderId });
      expect(ack).toMatchObject({ ok: true });
      expect(ack.key).toBeUndefined();
      const p = await hiderSock.waitFor((f) => f.t === "prompt", hFrom);
      if (p.t !== "prompt") throw new Error();
      prompts[hiderId] = p;
      await seeker.sync();
      const frames = seeker.frames.slice(from).filter((f) => f.t === "ack" || f.t === "event");
      seen.push(normalize(frames));
      expect(JSON.stringify(seeker.frames.slice(from))).not.toMatch(/"hint"|targetInSafeZone|"far"/);
    }
    expect(seen[1]).toBe(seen[0]);
    expect(seen[2]).toBe(seen[0]);
    expect(prompts[farId]).toMatchObject({ kind: "tagRequest", hint: "far" });
    expect(prompts[nearId]).not.toHaveProperty("hint");

    // Safe-zone hider accepting: rejected, and the reply's ack explains why.
    const sp = prompts[safeId];
    if (sp.kind !== "tagRequest") throw new Error();
    const reply = await action(inSafe, "tagReply", { captureId: sp.captureId, accept: true });
    expect(reply).toMatchObject({ ok: false, error: "targetInSafeZone", key: "capture.reject.targetInSafeZone" });
    await seeker.event("capture.rejected");
    // Disputes carry the hint for the host.
    const fp = prompts[farId];
    if (fp.kind !== "tagRequest") throw new Error();
    await action(far, "tagReply", { captureId: fp.captureId, accept: false });
    const disputed = await seeker.event("capture.disputed");
    expect(disputed.payload.hint).toBe("far");
  });
});
