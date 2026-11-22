// Scenarios 3, 4 and 7: shared zone timeline, reconnect with missed events, accuracy-aware boundary.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { destination, type Zone } from "@/shared";
import { mainZone } from "@/shared/test-helpers";
import { CENTER, Sock, hostOp, loc, setupLobby, startActive, startEnv, type TestEnv } from "./helpers";

let env: TestEnv;
beforeEach(async () => {
  env = await startEnv();
});
afterEach(async () => {
  await env.close();
});

describe("scenario 3: multi-phase shrinking zone", () => {
  it("gives every client the same clock, zones and phase events", async () => {
    const shrinking: Zone = mainZone(1000, {
      behavior: {
        kind: "shrinking",
        startDelaySec: 10,
        warningSec: 5,
        phases: [
          { holdSec: 0, shrinkSec: 20, center: CENTER, radiusM: 600 },
          { holdSec: 10, shrinkSec: 20, center: CENTER, radiusM: 300 },
        ],
      },
    });
    const s = await setupLobby(env, 3, { timing: { hidingSec: 0 }, visibility: { pings: { enabled: false } } }, [shrinking]);
    await startActive(env, s);
    env.advance(70_000);
    const types = ["zone.warning", "zone.transitionStart", "zone.transitionEnd"];
    await Promise.all(s.socks.map((k) => k.waitFor((f) => f.t === "event" && f.e.type === "zone.transitionEnd" && f.e.payload.phaseIndex === 1)));
    const seqs = s.socks.map((k) => k.events().filter((e) => types.includes(e.type)).map((e) => `${e.seq}:${e.type}:${e.payload.phaseIndex}@${e.at}`));
    expect(seqs[0]).toHaveLength(6);
    expect(seqs[1]).toEqual(seqs[0]);
    expect(seqs[2]).toEqual(seqs[0]);
    // Event times follow the timeline: first warning 5 s before the 10 s delay ends.
    const active = s.socks[0].lastView().clock.activeStartedAt!;
    const first = s.socks[0].events().find((e) => e.type === "zone.warning")!;
    expect(first.at - active).toBe(5000);

    const views = s.socks.map((k) => k.lastView());
    const strip = (c: object) => ({ ...c, serverNow: 0 });
    expect(strip(views[1].clock)).toEqual(strip(views[0].clock));
    expect(strip(views[2].clock)).toEqual(strip(views[0].clock));
    expect(views[1].zones).toEqual(views[0].zones);
  });

  it("pause shifts every deadline by the paused time", async () => {
    const s = await setupLobby(env, 2, { timing: { hidingSec: 60 } });
    await hostOp(s.socks[0], { op: "start" });
    const before = (await s.socks[1].view((v) => v.state === "countdown")).clock;
    env.advance(3000);
    expect((await hostOp(s.socks[0], { op: "pause" })).ok).toBe(true);
    await s.socks[1].view((v) => v.state === "paused");
    env.advance(30_000);
    const mk = s.socks[1].mark();
    expect((await hostOp(s.socks[0], { op: "resume" })).ok).toBe(true);
    const after = (await s.socks[1].view((v) => v.state === "countdown", mk)).clock;
    expect(after.hidingEndsAt! - before.hidingEndsAt!).toBe(30_000);
    expect(after.endsAt! - before.endsAt!).toBe(30_000);
    expect(after.pausedTotalMs).toBe(30_000);
  });

  it("emergency by any player pauses for everyone and stops their own sharing", async () => {
    const s = await setupLobby(env, 3, { timing: { hidingSec: 0 } });
    await startActive(env, s);
    const from = s.socks[0].mark();
    const r = await (async () => {
      const id = `em-${Date.now()}`;
      s.socks[2].send({ t: "emergency", opId: id });
      return s.socks[2].ack(id);
    })();
    expect(r.ok).toBe(true);
    await s.socks[0].event("match.emergency", from);
    const v = await s.socks[2].view((x) => x.state === "paused");
    expect(v.me?.tracking).toBe(false);
  });
});

describe("scenario 4: disconnect and reconnect", () => {
  it("keeps state, shows presence offline after 30 s, and replays missed events by lastSeq", async () => {
    const s = await setupLobby(env, 3, { timing: { hidingSec: 0 }, visibility: { pings: { enabled: true, intervalSec: 60, firstPingAfterSec: 20 } } });
    await startActive(env, s);
    const dropped = s.socks[2];
    const droppedId = s.users[2].user!.id;
    const roleBefore = dropped.lastView().me?.role;
    const lastSeq = Math.max(...dropped.events().map((e) => e.seq));
    await dropped.close();
    await new Promise((r) => setTimeout(r, 100)); // let the server see the close

    env.advance(31_000);
    const v = await s.socks[0].view((x) => x.players.find((p) => p.userId === droppedId)?.presence === "offline");
    expect(v.state).toBe("active");
    await hostOp(s.socks[0], { op: "pause" });
    await hostOp(s.socks[0], { op: "resume" });

    const back = await Sock.open(env.base, s.users[2].cookie);
    back.send({ t: "hello", matchId: s.matchId, lastSeq });
    expect(back.frames[0]?.t ?? (await back.waitFor((f) => f.t === "welcome")).t).toBe("welcome");
    const view = await back.view();
    expect(view.state).toBe("active");
    expect(view.me?.role).toBe(roleBefore);
    expect(view.me?.consentValid).toBe(true);
    await back.event("match.resumed");
    const replay = back.events();
    expect(replay.every((e) => e.seq > lastSeq)).toBe(true);
    expect(replay.map((e) => e.type)).toEqual(expect.arrayContaining(["match.paused", "match.resumed"]));
    // seq order is preserved
    expect(replay.map((e) => e.seq)).toEqual([...replay.map((e) => e.seq)].sort((a, b) => a - b));
    // Others see the player come back.
    await s.socks[0].event("player.rejoined");
    await back.close();
  });
});

describe("scenario 7: boundary checks", () => {
  it("poor accuracy never penalises; confident outside warns after debounce and penalises after grace", async () => {
    const s = await setupLobby(env, 2, {
      timing: { hidingSec: 0 },
      visibility: { pings: { enabled: false } },
      location: { maxAccuracyM: 50, maxSpeedMps: 100 },
      boundary: { toleranceM: 10, debounceSec: 20, graceSec: 45, penalty: "eliminate" },
    });
    await startActive(env, s);
    const [p, other] = s.socks;
    const pid = s.users[0].user!.id;
    const send = async (distM: number, acc: number, n: number) => {
      for (let i = 0; i < n; i++) {
        const [lng, lat] = destination(CENTER, distM + i * 0.5, 90);
        p.send(loc(lat, lng, acc));
        await p.sync();
        env.advance(3000, 3000);
      }
    };
    // Just outside but with terrible accuracy, then outside within accuracy: always uncertain.
    await send(1030, 80, 25);
    await send(1015, 20, 10);
    expect(p.events().some((e) => e.type.startsWith("boundary."))).toBe(false);
    expect(p.lastView().me?.boundary.state).toBe("ok");

    // Confidently outside (d = 150 > acc 10 + tolerance 10): pending, then warning after 20 s.
    const from = p.mark();
    await send(1150, 10, 6); // 18 s: still debouncing
    expect(p.events().some((e) => e.type === "boundary.warning")).toBe(false);
    await send(1150, 10, 2);
    const warn = await p.event("boundary.warning", from);
    expect(warn.audience).toBe(`user:${pid}`);
    expect(p.lastView().me?.boundary.state).toBe("warning");
    // Back inside during grace clears it.
    await send(980, 10, 1);
    await p.event("boundary.cleared", from);
    // Outside again: full debounce + grace before the penalty.
    await send(1150, 10, 8);
    expect(p.events().filter((e) => e.type === "boundary.warning")).toHaveLength(2);
    await send(1150, 10, 12);
    expect(p.events().some((e) => e.type === "boundary.penalty")).toBe(false);
    await send(1150, 10, 5);
    await p.event("boundary.penalty", from);
    await other.event("player.eliminated");
    // The other player never sees the private warnings.
    expect(other.events().some((e) => e.type === "boundary.warning")).toBe(false);
  });
});
