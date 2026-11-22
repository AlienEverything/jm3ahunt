import { distanceM, signedDistanceM, toLngLat } from "../geo";
import type { Settings } from "../schemas/settings";
import type { Zone } from "../schemas/zones";
import type { BoundaryState, Freshness, LocationFix, Presence } from "../types";
import { effectiveSignedDistanceM } from "../zones/timeline";
import { findMainZone } from "../zones/validate";

export const LIVE_WINDOW_MS = 10_000;

/** live < 10 s, delayed < staleAfterSec, stale after that, off when there is no fix. */
export function classifyFreshness(fixTs: number | null | undefined, now: number, staleAfterSec: number): Freshness {
  if (fixTs == null) return "off";
  const age = now - fixTs;
  if (age < LIVE_WINDOW_MS) return "live";
  if (age < staleAfterSec * 1000) return "delayed";
  return "stale";
}

export const isFresh = (fix: LocationFix | null | undefined, now: number, staleAfterSec: number): fix is LocationFix =>
  !!fix && now - fix.ts < staleAfterSec * 1000;

export interface PresenceInput {
  socketOpen: boolean;
  /** When the last socket closed. */
  disconnectedAt?: number;
  /** Server receive time of the last accepted fix. */
  lastFixAt?: number;
  /** True while the match expects GPS (tracking states, consented). */
  expectFixes: boolean;
}

/** Server-side presence for others: offline 30 s after the socket closes; stale without fresh fixes. */
export function classifyPresence(p: PresenceInput, now: number, settings: Settings): Presence {
  if (!p.socketOpen && (p.disconnectedAt === undefined || now - p.disconnectedAt >= settings.disconnect.offlineAfterSec * 1000)) {
    return "offline";
  }
  if (!p.socketOpen) return "stale";
  if (p.expectFixes && (p.lastFixAt === undefined || now - p.lastFixAt >= settings.location.staleAfterSec * 1000)) return "stale";
  return "online";
}

export type JumpDecision = "accept" | "suspect" | "drop";

/**
 * Jump filter. A fix implying a speed above maxSpeedMps (beyond both accuracy radii) is held as
 * `suspect` and only accepted once the next fix confirms it. Older-than-current fixes are dropped.
 */
export function checkJump(
  prev: LocationFix | null,
  suspect: LocationFix | null,
  next: LocationFix,
  maxSpeedMps: number,
): { decision: JumpDecision; suspect: LocationFix | null } {
  if (prev && next.ts <= prev.ts) return { decision: "drop", suspect };
  if (!prev) return { decision: "accept", suspect: null };
  const plausible = (a: LocationFix) => {
    const dt = Math.max(1, next.ts - a.ts) / 1000;
    const moved = Math.max(0, distanceM(toLngLat(a), toLngLat(next)) - a.acc - next.acc);
    return moved / dt <= maxSpeedMps;
  };
  if (plausible(prev)) return { decision: "accept", suspect: null };
  if (suspect && next.ts > suspect.ts && plausible(suspect)) return { decision: "accept", suspect: null };
  return { decision: "suspect", suspect: next };
}

export type BoundaryClass = "inside" | "outside" | "uncertain";

export interface BoundaryClassification {
  state: BoundaryClass;
  /** Violated zone when outside (main or restricted); the closest-call zone when uncertain. */
  zoneId?: string;
  reason?: "main" | "restricted" | "accuracy";
}

/** d = signed metres INTO a violation (positive = violating). */
function classifyViolation(d: number, acc: number, toleranceM: number): BoundaryClass {
  if (d > acc + toleranceM) return "outside";
  if (d <= -acc) return "inside";
  return "uncertain";
}

/**
 * Accuracy-aware boundary check for one fix against the effective play area and restricted zones.
 * Fixes worse than maxAccuracyM are always uncertain, so poor GPS never counts as outside.
 */
export function classifyBoundary(fix: LocationFix, zones: readonly Zone[], elapsedActiveMs: number, settings: Settings): BoundaryClassification {
  if (fix.acc > settings.location.maxAccuracyM) return { state: "uncertain", reason: "accuracy" };
  const p = toLngLat(fix);
  const tol = settings.boundary.toleranceM;
  let uncertain: BoundaryClassification | null = null;

  for (const r of zones.filter((z) => z.enabled && z.type === "restricted")) {
    const c = classifyViolation(-signedDistanceM(p, r.shape), fix.acc, tol);
    if (c === "outside") return { state: "outside", zoneId: r.id, reason: "restricted" };
    if (c === "uncertain") uncertain ??= { state: "uncertain", zoneId: r.id, reason: "restricted" };
  }
  const main = findMainZone(zones);
  if (main) {
    const c = classifyViolation(effectiveSignedDistanceM(main, p, elapsedActiveMs), fix.acc, tol);
    if (c === "outside") return { state: "outside", zoneId: main.id, reason: "main" };
    if (c === "uncertain") uncertain ??= { state: "uncertain", zoneId: main.id, reason: "main" };
  }
  return uncertain ?? { state: "inside" };
}

/** Confidently inside a zone (used for safe-zone capture protection). */
export function classifyInZone(fix: LocationFix, zone: Zone, settings: Settings): BoundaryClass {
  if (fix.acc > settings.location.maxAccuracyM) return "uncertain";
  // Being outside the zone is the "violation" here; tolerance is not applied in the player's favour.
  const c = classifyViolation(signedDistanceM(toLngLat(fix), zone.shape), fix.acc, 0);
  return c === "outside" ? "outside" : c === "inside" ? "inside" : "uncertain";
}

export const INITIAL_BOUNDARY: BoundaryState = { phase: "ok", outsideFixes: 0 };

export type BoundaryEffect =
  | { type: "warn"; warningEndsAt: number; zoneId?: string }
  | { type: "penalty"; action: Settings["boundary"]["penalty"]; zoneId?: string }
  | { type: "cleared" };

/**
 * Penalty pipeline reducer, called once per accepted fix.
 * outside ≥ debounceSec and ≥ 2 fixes → warning (grace) → still outside at warningEndsAt → penalty.
 * Uncertain never advances; confidently inside clears.
 */
export function stepBoundary(
  state: BoundaryState,
  c: BoundaryClassification,
  now: number,
  settings: Settings,
): { state: BoundaryState; effects: BoundaryEffect[] } {
  if (c.state === "uncertain") return { state, effects: [] };
  if (c.state === "inside") {
    const effects: BoundaryEffect[] = state.phase === "warning" || state.phase === "penalized" ? [{ type: "cleared" }] : [];
    return { state: INITIAL_BOUNDARY, effects };
  }
  const { debounceSec, graceSec, penalty } = settings.boundary;
  switch (state.phase) {
    case "ok":
      return { state: { phase: "pending", outsideSince: now, outsideFixes: 1, zoneId: c.zoneId }, effects: [] };
    case "pending": {
      const outsideFixes = state.outsideFixes + 1;
      if (now - (state.outsideSince ?? now) >= debounceSec * 1000 && outsideFixes >= 2) {
        const warningEndsAt = now + graceSec * 1000;
        return {
          state: { ...state, phase: "warning", outsideFixes, warningEndsAt, zoneId: c.zoneId },
          effects: [{ type: "warn", warningEndsAt, zoneId: c.zoneId }],
        };
      }
      return { state: { ...state, outsideFixes, zoneId: c.zoneId }, effects: [] };
    }
    case "warning": {
      const next = { ...state, outsideFixes: state.outsideFixes + 1 };
      if (now >= (state.warningEndsAt ?? now)) {
        return { state: { ...next, phase: "penalized" }, effects: [{ type: "penalty", action: penalty, zoneId: c.zoneId }] };
      }
      return { state: next, effects: [] };
    }
    case "penalized":
      return { state: { ...state, outsideFixes: state.outsideFixes + 1 }, effects: [] };
  }
}

/** Shift boundary timers after a pause. */
export function shiftBoundary(state: BoundaryState, shiftMs: number): BoundaryState {
  return {
    ...state,
    ...(state.outsideSince !== undefined ? { outsideSince: state.outsideSince + shiftMs } : {}),
    ...(state.warningEndsAt !== undefined ? { warningEndsAt: state.warningEndsAt + shiftMs } : {}),
  };
}
