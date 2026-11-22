import { distanceM, toLngLat } from "../geo";
import { isFresh } from "../location";
import type { CaptureMethod, RescueMethod, Settings } from "../schemas/settings";
import type { Role } from "../schemas/zones";
import type { LocationFix, MatchClock, MatchResult, MatchState, PlayerStats, PlayerStatus, Scores, VictoryReason, Winner } from "../types";

export interface CapturePlayer {
  userId: string;
  role: Role | null;
  status: PlayerStatus;
  freezeEndsAt?: number;
  jailEndsAt?: number;
}

export type CaptureRejection =
  | "wrongState"
  | "self"
  | "methodDisabled"
  | "notSeeker"
  | "targetNotHider"
  | "targetJailed"
  | "targetFrozen"
  | "targetNotFree"
  | "targetInSafeZone"
  | "pendingExists";

export type Check<R extends string> = { ok: true } | { ok: false; reason: R; key: string };
const reject = <R extends string>(prefix: string, reason: R): Check<R> => ({ ok: false, reason, key: `${prefix}.${reason}` });

export interface CanCaptureInput {
  state: MatchState;
  seeker: CapturePlayer;
  hider: CapturePlayer;
  method: CaptureMethod;
  settings: Settings;
  /** A pending capture already exists for this hider. */
  pendingForHider: boolean;
  /** Hider confidently inside an enabled safe zone (classifyInZone === "inside" on a fresh fix). */
  hiderInSafeZone: boolean;
}

/** Rule check for tag / QR / code captures. `key` is the i18n reason shown to the seeker. */
export function canCapture(i: CanCaptureInput): Check<CaptureRejection> {
  const r = (reason: CaptureRejection) => reject("capture.reject", reason);
  if (i.state !== "active") return r("wrongState");
  if (i.seeker.userId === i.hider.userId) return r("self");
  if (!i.settings.capture.methods.includes(i.method)) return r("methodDisabled");
  if (i.seeker.role !== "seeker" || i.seeker.status !== "free") return r("notSeeker");
  if (i.hider.role !== "hider") return r("targetNotHider");
  if (i.hider.status === "jailed") return r("targetJailed");
  if (i.hider.status === "frozen") return r("targetFrozen");
  if (i.hider.status !== "free") return r("targetNotFree");
  if (i.hiderInSafeZone) return r("targetInSafeZone");
  if (i.pendingForHider) return r("pendingExists");
  return { ok: true };
}

/** Player state after a confirmed capture. */
export function applyOutcome(p: CapturePlayer, settings: Settings, now: number): CapturePlayer {
  const base = { ...p };
  delete base.freezeEndsAt;
  delete base.jailEndsAt;
  switch (settings.capture.outcome) {
    case "convert":
      return { ...base, role: "seeker", status: "free" };
    case "eliminate":
      return { ...base, status: "eliminated" };
    case "jail":
      return { ...base, status: "jailed", ...(settings.jail.maxJailSec > 0 ? { jailEndsAt: now + settings.jail.maxJailSec * 1000 } : {}) };
    case "freeze":
      return { ...base, status: "frozen", freezeEndsAt: now + settings.capture.freezeSec * 1000 };
  }
}

/** Frozen/jailed players whose timer ran out become free. Returns null when nothing changes. */
export function releaseIfDue(p: CapturePlayer, now: number): CapturePlayer | null {
  if (p.status === "frozen" && p.freezeEndsAt !== undefined && now >= p.freezeEndsAt) {
    const { freezeEndsAt: _f, ...rest } = p;
    return { ...rest, status: "free" };
  }
  if (p.status === "jailed" && p.jailEndsAt !== undefined && now >= p.jailEndsAt) {
    const { jailEndsAt: _j, ...rest } = p;
    return { ...rest, status: "free" };
  }
  return null;
}

/** Pause shifting for per-player timers. */
export function shiftPlayerTimers(p: CapturePlayer, shiftMs: number): CapturePlayer {
  return {
    ...p,
    ...(p.freezeEndsAt !== undefined ? { freezeEndsAt: p.freezeEndsAt + shiftMs } : {}),
    ...(p.jailEndsAt !== undefined ? { jailEndsAt: p.jailEndsAt + shiftMs } : {}),
  };
}

export type RescueRejection = "wrongState" | "rescueDisabled" | "methodMismatch" | "notFreeHider" | "targetNotJailed" | "noRescuesLeft" | "cooldown" | "self";

export interface CanRescueInput {
  state: MatchState;
  rescuer: CapturePlayer;
  jailed: CapturePlayer;
  method: RescueMethod;
  settings: Settings;
  rescuesDone: number;
  lastRescueAt?: number;
  now: number;
}

export function canRescue(i: CanRescueInput): Check<RescueRejection> {
  const r = (reason: RescueRejection) => reject("rescue.reject", reason);
  const { jail, capture } = i.settings;
  if (i.state !== "active") return r("wrongState");
  if (capture.outcome !== "jail" || !jail.rescue.enabled) return r("rescueDisabled");
  if (jail.rescue.method !== i.method) return r("methodMismatch");
  if (i.rescuer.userId === i.jailed.userId) return r("self");
  if (i.rescuer.role !== "hider" || i.rescuer.status !== "free") return r("notFreeHider");
  if (i.jailed.status !== "jailed") return r("targetNotJailed");
  if (i.rescuesDone >= jail.rescue.maxRescues) return r("noRescuesLeft");
  if (i.lastRescueAt !== undefined && i.now - i.lastRescueAt < jail.rescue.cooldownSec * 1000) return r("cooldown");
  return { ok: true };
}

export function applyRescue(p: CapturePlayer): CapturePlayer {
  const { jailEndsAt: _j, ...rest } = p;
  return { ...rest, status: "free" };
}

/**
 * Proximity hint for the seeker: "far" when both fixes are fresh and farther apart than
 * maxTagDistanceM + both accuracies. GPS is never proof; null when the hint is off.
 */
export function proximityHint(
  seekerFix: LocationFix | null | undefined,
  hiderFix: LocationFix | null | undefined,
  settings: Settings,
  now: number,
): "near" | "far" | "unknown" | null {
  if (settings.capture.proximity === "off") return null;
  const stale = settings.location.staleAfterSec;
  if (!isFresh(seekerFix, now, stale) || !isFresh(hiderFix, now, stale)) return "unknown";
  const d = distanceM(toLngLat(seekerFix), toLngLat(hiderFix));
  return d > settings.capture.maxTagDistanceM + seekerFix.acc + hiderFix.acc ? "far" : "near";
}

// ── stats & scoring ─────────────────────────────────────────────────────────

export const emptyStats = (): PlayerStats => ({ captures: 0, timesCaptured: 0, survivedSec: 0, rescues: 0 });

type StatsMap = Record<string, PlayerStats>;
const bump = (stats: StatsMap, id: string, patch: (s: PlayerStats) => Partial<PlayerStats>): StatsMap => {
  const cur = stats[id] ?? emptyStats();
  return { ...stats, [id]: { ...cur, ...patch(cur) } };
};

export function recordCapture(stats: StatsMap, seekerId: string, hiderId: string): StatsMap {
  const s = bump(stats, seekerId, (c) => ({ captures: c.captures + 1 }));
  return bump(s, hiderId, (c) => ({ timesCaptured: c.timesCaptured + 1 }));
}

export const recordRescue = (stats: StatsMap, rescuerId: string): StatsMap => bump(stats, rescuerId, (c) => ({ rescues: c.rescues + 1 }));

/** Hiders still in the game (free or temporarily frozen) accrue survival time. */
const stillHiding = (p: CapturePlayer) => p.role === "hider" && (p.status === "free" || p.status === "frozen");

export function accrueSurvival(stats: StatsMap, players: readonly CapturePlayer[], dtSec: number): StatsMap {
  let s = stats;
  for (const p of players) if (stillHiding(p)) s = bump(s, p.userId, (c) => ({ survivedSec: c.survivedSec + dtSec }));
  return s;
}

export function computeScores(stats: StatsMap, settings: Settings): Scores {
  const all = Object.values(stats);
  const seekers = all.reduce((n, s) => n + s.captures, 0) * settings.victory.pointsPerCapture;
  const hiders = all.reduce((n, s) => n + Math.floor(s.survivedSec / 60), 0) * settings.victory.pointsPerMinute;
  return { seekers, hiders };
}

// ── victory ─────────────────────────────────────────────────────────────────

export interface VictoryInput {
  state: MatchState;
  now: number;
  clock: MatchClock;
  settings: Settings;
  players: readonly CapturePlayer[];
  pendingCaptures: number;
  stats: StatsMap;
}

export type VictoryCheck =
  | { status: "ongoing" }
  | { status: "overtime"; until: number }
  | { status: "decided"; winner: Winner; reason: VictoryReason; scores?: Scores };

/**
 * Seekers win when no hider is free (jailed counts as caught; frozen does not). Hiders win if ≥ 1
 * is still hiding at endsAt. Overtime: at endsAt with captures pending, play on up to overtimeSec.
 * Points mode decides by score instead, with tieBreak on equal scores.
 */
export function evaluateVictory(i: VictoryInput): VictoryCheck {
  if (i.state !== "active") return { status: "ongoing" };
  const active = i.players.filter((p) => p.status !== "withdrawn");
  const hidersLeft = active.filter(stillHiding).length;
  const seekersLeft = active.filter((p) => p.role === "seeker" && p.status !== "eliminated").length;
  const endsAt = i.clock.endsAt ?? Infinity;
  const timeUp = i.now >= endsAt;

  const decide = (fallback: Winner, reason: VictoryReason): VictoryCheck => {
    if (i.settings.victory.mode !== "points") return { status: "decided", winner: fallback, reason };
    const scores = computeScores(i.stats, i.settings);
    const winner: Winner =
      scores.seekers > scores.hiders ? "seekers" : scores.hiders > scores.seekers ? "hiders" : i.settings.victory.tieBreak;
    return { status: "decided", winner, reason: "points", scores };
  };

  if (hidersLeft === 0) return decide("seekers", "allCaught");
  if (seekersLeft === 0) return decide("hiders", "noSeekers");
  if (!timeUp) return { status: "ongoing" };
  const until = endsAt + i.settings.timing.overtimeSec * 1000;
  if (i.pendingCaptures > 0 && i.now < until) return { status: "overtime", until };
  return decide("hiders", "timeUp");
}

export function buildResult(v: Extract<VictoryCheck, { status: "decided" }>, endedAt: number, stats: StatsMap): MatchResult {
  return { winner: v.winner, reason: v.reason, endedAt, ...(v.scores ? { scores: v.scores } : {}), stats };
}
