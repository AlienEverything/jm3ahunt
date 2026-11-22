import { describe, expect, it } from "vitest";
import { startClock } from "../match/clock";
import { at, fixAt, settingsWith } from "../test-helpers";
import {
  accrueSurvival,
  applyOutcome,
  applyRescue,
  buildResult,
  canCapture,
  canRescue,
  computeScores,
  emptyStats,
  evaluateVictory,
  proximityHint,
  recordCapture,
  releaseIfDue,
  shiftPlayerTimers,
  type CanCaptureInput,
  type CapturePlayer,
  type VictoryInput,
} from ".";

const seeker: CapturePlayer = { userId: "s", role: "seeker", status: "free" };
const hider: CapturePlayer = { userId: "h", role: "hider", status: "free" };
const base: CanCaptureInput = { state: "active", seeker, hider, method: "mutual", settings: settingsWith(), pendingForHider: false, hiderInSafeZone: false };
const reason = (over: Partial<CanCaptureInput>) => {
  const r = canCapture({ ...base, ...over });
  return r.ok ? "ok" : r.reason;
};

describe("canCapture", () => {
  it("allows a free seeker to tag a free hider during the hunt", () => {
    expect(reason({})).toBe("ok");
  });
  it("rejects with a reason (and an i18n key)", () => {
    expect(reason({ state: "hiding" })).toBe("wrongState");
    expect(reason({ hider: { ...seeker } })).toBe("self");
    expect(reason({ method: "qr", settings: settingsWith({ capture: { methods: ["mutual"] } }) })).toBe("methodDisabled");
    expect(reason({ seeker: { ...seeker, role: "hider" } })).toBe("notSeeker");
    expect(reason({ seeker: { ...seeker, status: "frozen" } })).toBe("notSeeker");
    expect(reason({ hider: { ...hider, role: "seeker" } })).toBe("targetNotHider");
    expect(reason({ hider: { ...hider, status: "jailed" } })).toBe("targetJailed");
    expect(reason({ hider: { ...hider, status: "frozen" } })).toBe("targetFrozen");
    expect(reason({ hider: { ...hider, status: "eliminated" } })).toBe("targetNotFree");
    expect(reason({ hiderInSafeZone: true })).toBe("targetInSafeZone");
    expect(reason({ pendingForHider: true })).toBe("pendingExists");
    const r = canCapture({ ...base, pendingForHider: true });
    expect(!r.ok && r.key).toBe("capture.reject.pendingExists");
  });
});

describe("outcomes and timers", () => {
  const now = 1000;
  it("convert / eliminate / jail / freeze", () => {
    expect(applyOutcome(hider, settingsWith({ capture: { outcome: "convert" } }), now)).toEqual({ userId: "h", role: "seeker", status: "free" });
    expect(applyOutcome(hider, settingsWith({ capture: { outcome: "eliminate" } }), now).status).toBe("eliminated");
    expect(applyOutcome(hider, settingsWith({ capture: { outcome: "jail" }, jail: { maxJailSec: 60 } }), now)).toMatchObject({ status: "jailed", jailEndsAt: 61_000 });
    expect(applyOutcome(hider, settingsWith({ capture: { outcome: "jail" }, jail: { maxJailSec: 0 } }), now).jailEndsAt).toBeUndefined();
    expect(applyOutcome(hider, settingsWith({ capture: { outcome: "freeze", freezeSec: 30 } }), now)).toMatchObject({ status: "frozen", freezeEndsAt: 31_000 });
  });

  it("timers release, shift on pause, and rescue frees", () => {
    const frozen: CapturePlayer = { ...hider, status: "frozen", freezeEndsAt: 5000 };
    expect(releaseIfDue(frozen, 4999)).toBeNull();
    expect(releaseIfDue(frozen, 5000)).toEqual({ ...hider, status: "free" });
    const jailed: CapturePlayer = { ...hider, status: "jailed", jailEndsAt: 5000 };
    expect(releaseIfDue(jailed, 5000)?.status).toBe("free");
    expect(releaseIfDue({ ...hider, status: "jailed" }, 9e12)).toBeNull(); // no auto release
    expect(shiftPlayerTimers(jailed, 2000).jailEndsAt).toBe(7000);
    expect(applyRescue(jailed)).toEqual({ ...hider, status: "free" });
  });
});

describe("canRescue", () => {
  const settings = settingsWith({ capture: { outcome: "jail" }, jail: { rescue: { enabled: true, method: "confirm", maxRescues: 2, cooldownSec: 60 } } });
  const jailed: CapturePlayer = { userId: "j", role: "hider", status: "jailed" };
  const r = (over: Partial<Parameters<typeof canRescue>[0]>) => {
    const res = canRescue({ state: "active", rescuer: hider, jailed, method: "confirm", settings, rescuesDone: 0, now: 100_000, ...over });
    return res.ok ? "ok" : res.reason;
  };
  it("rules", () => {
    expect(r({})).toBe("ok");
    expect(r({ state: "paused" })).toBe("wrongState");
    expect(r({ settings: settingsWith() })).toBe("rescueDisabled");
    expect(r({ method: "qr" })).toBe("methodMismatch");
    expect(r({ rescuer: { ...jailed } })).toBe("self");
    expect(r({ rescuer: seeker })).toBe("notFreeHider");
    expect(r({ rescuer: { ...hider, status: "frozen" } })).toBe("notFreeHider");
    expect(r({ jailed: { ...jailed, status: "free" } })).toBe("targetNotJailed");
    expect(r({ rescuesDone: 2 })).toBe("noRescuesLeft");
    expect(r({ lastRescueAt: 50_000 })).toBe("cooldown");
    expect(r({ lastRescueAt: 40_000 })).toBe("ok");
  });
});

describe("proximity hint", () => {
  const s = settingsWith({ capture: { proximity: "warn", maxTagDistanceM: 15 } });
  it("far only when both fixes are fresh and clearly apart; never proof", () => {
    expect(proximityHint(fixAt(at(0), 0, 5), fixAt(at(20), 0, 5), s, 1000)).toBe("near");
    expect(proximityHint(fixAt(at(0), 0, 5), fixAt(at(100), 0, 5), s, 1000)).toBe("far");
    expect(proximityHint(fixAt(at(0), 0, 5), fixAt(at(100), 0, 5), s, 60_000)).toBe("unknown");
    expect(proximityHint(null, fixAt(at(100), 0, 5), s, 1000)).toBe("unknown");
    expect(proximityHint(fixAt(at(0), 0, 5), fixAt(at(100), 0, 5), settingsWith({ capture: { proximity: "off" } }), 1000)).toBeNull();
  });
});

describe("victory", () => {
  const settings = settingsWith({ timing: { durationMin: 10, overtimeSec: 60 } });
  const clock = startClock(0, settings);
  const endsAt = clock.endsAt!;
  const v = (over: Partial<VictoryInput>) =>
    evaluateVictory({ state: "active", now: endsAt - 1, clock, settings, players: [seeker, hider], pendingCaptures: 0, stats: {}, ...over });

  it("ongoing while hiders are free and time remains", () => {
    expect(v({})).toEqual({ status: "ongoing" });
    expect(v({ state: "paused", now: endsAt + 1e6 })).toEqual({ status: "ongoing" });
  });

  it("seekers win when no hider is free; jailed counts as caught, frozen does not", () => {
    expect(v({ players: [seeker, { ...hider, status: "jailed" }] })).toMatchObject({ status: "decided", winner: "seekers", reason: "allCaught" });
    expect(v({ players: [seeker, { ...hider, role: "seeker" }] })).toMatchObject({ winner: "seekers" }); // converted
    expect(v({ players: [seeker, { ...hider, status: "frozen" }] })).toEqual({ status: "ongoing" });
    expect(v({ players: [seeker, { ...hider, status: "withdrawn" }] })).toMatchObject({ winner: "seekers" });
  });

  it("hiders win at time up; overtime while a capture is pending", () => {
    expect(v({ now: endsAt })).toMatchObject({ status: "decided", winner: "hiders", reason: "timeUp" });
    expect(v({ now: endsAt, pendingCaptures: 1 })).toEqual({ status: "overtime", until: endsAt + 60_000 });
    expect(v({ now: endsAt + 60_000, pendingCaptures: 1 })).toMatchObject({ winner: "hiders", reason: "timeUp" });
    expect(v({ players: [{ ...seeker, status: "withdrawn" }, hider] })).toMatchObject({ winner: "hiders", reason: "noSeekers" });
  });

  it("points mode decides by score with tie-break", () => {
    const ps = settingsWith({ victory: { mode: "points", pointsPerCapture: 10, pointsPerMinute: 1, tieBreak: "draw" } });
    let stats = recordCapture({}, "s", "h2");
    stats = accrueSurvival(stats, [hider, { userId: "x", role: "hider", status: "eliminated" }], 300);
    expect(stats.h.survivedSec).toBe(300);
    expect(stats.x).toBeUndefined();
    expect(computeScores(stats, ps)).toEqual({ seekers: 10, hiders: 5 });
    const r = v({ settings: ps, now: endsAt, stats });
    expect(r).toMatchObject({ status: "decided", winner: "seekers", reason: "points", scores: { seekers: 10, hiders: 5 } });
    const tie = v({ settings: ps, now: endsAt, stats: { h: { ...emptyStats(), survivedSec: 600 } , s: { ...emptyStats(), captures: 1 } } });
    expect(tie).toMatchObject({ winner: "draw" });
    if (r.status === "decided") expect(buildResult(r, endsAt, stats)).toMatchObject({ winner: "seekers", endedAt: endsAt, scores: { seekers: 10 } });
  });

  it("stats: captures and times captured", () => {
    const s = recordCapture(recordCapture({}, "s", "h"), "s", "h");
    expect(s.s.captures).toBe(2);
    expect(s.h.timesCaptured).toBe(2);
  });
});
