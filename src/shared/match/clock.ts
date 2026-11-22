import type { Settings } from "../schemas/settings";
import type { MatchClock, MatchState } from "../types";
import type { PausableState } from "./stateMachine";

const DEADLINES = ["countdownEndsAt", "hidingEndsAt", "activeStartedAt", "endsAt"] as const;

/** All deadlines are fixed when the countdown starts. */
export function startClock(now: number, settings: Settings): MatchClock {
  const countdownEndsAt = now + settings.timing.countdownSec * 1000;
  const hidingEndsAt = countdownEndsAt + settings.timing.hidingSec * 1000;
  return {
    countdownEndsAt,
    hidingEndsAt,
    activeStartedAt: hidingEndsAt,
    endsAt: hidingEndsAt + settings.timing.durationMin * 60_000,
    pausedTotalMs: 0,
    activePausedMs: 0,
  };
}

export function pauseClock(clock: MatchClock, now: number, from: PausableState): MatchClock {
  if (clock.pausedAt !== undefined) return clock;
  return { ...clock, pausedAt: now, pausedFrom: from };
}

/** Shift every deadline still in the future at pause time by the paused duration. */
export function resumeClock(clock: MatchClock, now: number): { clock: MatchClock; shiftMs: number; resumeTo: PausableState | undefined } {
  const { pausedAt } = clock;
  if (pausedAt === undefined) return { clock, shiftMs: 0, resumeTo: undefined };
  const shiftMs = Math.max(0, now - pausedAt);
  const next: MatchClock = { ...clock, pausedTotalMs: clock.pausedTotalMs + shiftMs };
  for (const k of DEADLINES) {
    const v = clock[k];
    if (v !== undefined && v > pausedAt) next[k] = v + shiftMs;
  }
  if (clock.activeStartedAt !== undefined && pausedAt >= clock.activeStartedAt) next.activePausedMs = clock.activePausedMs + shiftMs;
  delete next.pausedAt;
  delete next.pausedFrom;
  return { clock: next, shiftMs, resumeTo: clock.pausedFrom };
}

/** Time since seekers were released, excluding pauses. Frozen while paused. */
export function elapsedActiveMs(clock: MatchClock, now: number): number {
  if (clock.activeStartedAt === undefined) return 0;
  const at = clock.pausedAt ?? now;
  return Math.max(0, at - clock.activeStartedAt - clock.activePausedMs);
}

/** Converts elapsed-active ms back to absolute time (valid while not paused). */
export const activeElapsedToAbs = (clock: MatchClock, elapsedMs: number) =>
  (clock.activeStartedAt ?? 0) + clock.activePausedMs + elapsedMs;

/** The timed transition due now, if any (the runtime's tick calls this). Victory is separate. */
export function dueTransition(state: MatchState, clock: MatchClock, now: number): MatchState | null {
  if (clock.pausedAt !== undefined) return null;
  if (state === "countdown" && clock.countdownEndsAt !== undefined && now >= clock.countdownEndsAt) {
    return clock.hidingEndsAt !== undefined && clock.hidingEndsAt > clock.countdownEndsAt ? "hiding" : "active";
  }
  if (state === "hiding" && clock.hidingEndsAt !== undefined && now >= clock.hidingEndsAt) return "active";
  return null;
}

/** Number of scheduled pings that should have happened by `elapsedMs`. */
export function pingCountAt(settings: Settings, elapsedMs: number): number {
  const p = settings.visibility.pings;
  if (!p.enabled) return 0;
  const first = p.firstPingAfterSec * 1000;
  const durationMs = settings.timing.durationMin * 60_000;
  const e = Math.min(elapsedMs, durationMs);
  if (e < first) return 0;
  return Math.floor((e - first) / (p.intervalSec * 1000)) + 1;
}

/** Absolute time of the next scheduled ping, or undefined if none remain / pings are off. */
export function nextPingAt(clock: MatchClock, settings: Settings, now: number): number | undefined {
  const p = settings.visibility.pings;
  if (!p.enabled || clock.activeStartedAt === undefined) return undefined;
  const k = pingCountAt(settings, elapsedActiveMs(clock, now));
  const nextElapsed = p.firstPingAfterSec * 1000 + k * p.intervalSec * 1000;
  if (nextElapsed > settings.timing.durationMin * 60_000) return undefined;
  return activeElapsedToAbs(clock, nextElapsed);
}

/** Final-reveal window: the last finalRevealMin minutes of the active phase. */
export function inFinalReveal(state: MatchState, clock: MatchClock, settings: Settings, now: number): boolean {
  const min = settings.visibility.pings.finalRevealMin;
  if (min <= 0 || state !== "active" || clock.endsAt === undefined) return false;
  return now >= clock.endsAt - min * 60_000;
}
