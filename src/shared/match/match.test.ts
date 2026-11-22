import { describe, expect, it } from "vitest";
import { MATCH_STATES, type MatchState } from "../types";
import { settingsWith } from "../test-helpers";
import { activeElapsedToAbs, dueTransition, elapsedActiveMs, inFinalReveal, nextPingAt, pauseClock, pingCountAt, resumeClock, startClock } from "./clock";
import { IllegalTransitionError, MATCH_TRANSITIONS, assertTransition, canTransition, isTerminal } from "./stateMachine";

describe("state machine", () => {
  const legal: Array<[MatchState, MatchState]> = [
    ["draft", "lobby"],
    ["lobby", "preflight"],
    ["preflight", "countdown"],
    ["preflight", "lobby"],
    ["countdown", "hiding"],
    ["countdown", "active"],
    ["hiding", "active"],
    ["active", "finished"],
    ["countdown", "paused"],
    ["hiding", "paused"],
    ["active", "paused"],
    ["paused", "active"],
    ["finished", "archived"],
  ];
  it.each(legal)("%s → %s is legal", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
    expect(() => assertTransition(from, to)).not.toThrow();
  });

  const illegal: Array<[MatchState, MatchState]> = [
    ["draft", "countdown"],
    ["lobby", "active"],
    ["lobby", "paused"],
    ["active", "hiding"],
    ["active", "lobby"],
    ["finished", "active"],
    ["archived", "lobby"],
    ["paused", "lobby"],
    ["hiding", "countdown"],
    ["draft", "paused"],
  ];
  it.each(illegal)("%s → %s throws", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
    expect(() => assertTransition(from, to)).toThrow(IllegalTransitionError);
  });

  it("every non-terminal state can end", () => {
    for (const s of MATCH_STATES) if (!isTerminal(s)) expect(canTransition(s, "finished")).toBe(true);
    expect(MATCH_TRANSITIONS.archived).toEqual([]);
  });

  it("resume only returns to the state the match was paused from", () => {
    expect(canTransition("paused", "hiding", { pausedFrom: "hiding" })).toBe(true);
    expect(canTransition("paused", "active", { pausedFrom: "hiding" })).toBe(false);
    expect(canTransition("paused", "finished", { pausedFrom: "hiding" })).toBe(true);
  });
});

describe("clock", () => {
  const s = settingsWith({ timing: { countdownSec: 10, hidingSec: 300, durationMin: 30 } });
  const t0 = 1_000_000;

  it("derives all deadlines from settings", () => {
    const c = startClock(t0, s);
    expect(c.countdownEndsAt).toBe(t0 + 10_000);
    expect(c.hidingEndsAt).toBe(t0 + 310_000);
    expect(c.activeStartedAt).toBe(t0 + 310_000);
    expect(c.endsAt).toBe(t0 + 310_000 + 1_800_000);
  });

  it("timed transitions: countdown → hiding → active; skips hiding without a head start", () => {
    const c = startClock(t0, s);
    expect(dueTransition("countdown", c, t0 + 9_999)).toBeNull();
    expect(dueTransition("countdown", c, t0 + 10_000)).toBe("hiding");
    expect(dueTransition("hiding", c, t0 + 310_000)).toBe("active");
    const noHide = startClock(t0, settingsWith({ timing: { hidingSec: 0 } }));
    expect(dueTransition("countdown", noHide, t0 + 10_000)).toBe("active");
    expect(dueTransition("paused", pauseClock(c, t0, "countdown"), t0 + 60_000)).toBeNull();
  });

  it("pause during hiding shifts every future deadline; elapsed active stays 0", () => {
    const c = startClock(t0, s);
    const paused = pauseClock(c, t0 + 100_000, "hiding");
    expect(elapsedActiveMs(paused, t0 + 200_000)).toBe(0);
    const { clock: r, shiftMs, resumeTo } = resumeClock(paused, t0 + 160_000);
    expect(shiftMs).toBe(60_000);
    expect(resumeTo).toBe("hiding");
    expect(r.countdownEndsAt).toBe(c.countdownEndsAt); // already passed, unchanged
    expect(r.hidingEndsAt).toBe(c.hidingEndsAt! + 60_000);
    expect(r.activeStartedAt).toBe(c.activeStartedAt! + 60_000);
    expect(r.endsAt).toBe(c.endsAt! + 60_000);
    expect(r.pausedTotalMs).toBe(60_000);
    expect(r.activePausedMs).toBe(0);
    expect(r.pausedAt).toBeUndefined();
  });

  it("pause during active freezes elapsed time and excludes it afterwards", () => {
    const c = startClock(t0, s);
    const start = c.activeStartedAt!;
    expect(elapsedActiveMs(c, start + 120_000)).toBe(120_000);
    const paused = pauseClock(c, start + 120_000, "active");
    expect(elapsedActiveMs(paused, start + 500_000)).toBe(120_000);
    const { clock: r } = resumeClock(paused, start + 180_000);
    expect(r.activeStartedAt).toBe(start);
    expect(r.activePausedMs).toBe(60_000);
    expect(r.endsAt).toBe(c.endsAt! + 60_000);
    expect(elapsedActiveMs(r, start + 240_000)).toBe(180_000);
    expect(activeElapsedToAbs(r, 180_000)).toBe(start + 240_000);
  });

  it("double pause keeps the first pause time; resume without pause is a no-op", () => {
    const c = pauseClock(startClock(t0, s), t0 + 5, "countdown");
    expect(pauseClock(c, t0 + 50, "countdown").pausedAt).toBe(t0 + 5);
    const plain = startClock(t0, s);
    expect(resumeClock(plain, t0 + 99).shiftMs).toBe(0);
  });

  it("ping schedule: first after firstPingAfterSec, then every intervalSec, none after the end", () => {
    const ps = settingsWith({ timing: { durationMin: 30 }, visibility: { pings: { enabled: true, firstPingAfterSec: 300, intervalSec: 300 } } });
    expect(pingCountAt(ps, 299_999)).toBe(0);
    expect(pingCountAt(ps, 300_000)).toBe(1);
    expect(pingCountAt(ps, 899_999)).toBe(2);
    expect(pingCountAt(ps, 99_000_000)).toBe(6); // 5,10,...,30 min
    const c = startClock(t0, ps);
    const start = c.activeStartedAt!;
    expect(nextPingAt(c, ps, t0)).toBe(start + 300_000);
    expect(nextPingAt(c, ps, start + 300_000)).toBe(start + 600_000);
    expect(nextPingAt(c, ps, start + 1_800_000)).toBeUndefined();
    expect(nextPingAt(c, settingsWith({ visibility: { pings: { enabled: false } } }), t0)).toBeUndefined();
  });

  it("final reveal window covers the last N minutes of the active phase only", () => {
    const fs = settingsWith({ timing: { durationMin: 30 }, visibility: { pings: { finalRevealMin: 5 } } });
    const c = startClock(t0, fs);
    expect(inFinalReveal("active", c, fs, c.endsAt! - 300_001)).toBe(false);
    expect(inFinalReveal("active", c, fs, c.endsAt! - 300_000)).toBe(true);
    expect(inFinalReveal("paused", c, fs, c.endsAt! - 1)).toBe(false);
    expect(inFinalReveal("active", c, settingsWith(), c.endsAt! - 1)).toBe(false);
  });
});
