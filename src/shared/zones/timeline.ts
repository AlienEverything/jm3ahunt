import { distanceM, enclosingCircle, signedDistanceM } from "../geo";
import type { LngLat, Zone } from "../schemas/zones";

export interface Circle {
  center: LngLat;
  radiusM: number;
}

export type TimelinePhase = "static" | "delay" | "hold" | "transition" | "final";

export interface ZoneTimelineState {
  kind: "static" | "shrinking" | "moving";
  phase: TimelinePhase;
  /** Step currently holding/transitioning (0-based); equals phaseCount once final. -1 when static. */
  phaseIndex: number;
  phaseCount: number;
  /** Current dynamic circle; null when static (approved area only). */
  circle: Circle | null;
  /** Circle the boundary is heading to (preview), null when nothing is upcoming. */
  nextCircle: Circle | null;
  /** 0..1 progress within a transition, else 0. */
  progress: number;
  /** Until the boundary next starts or stops moving; null when nothing more happens. */
  msUntilNextChange: number | null;
  /** True within `warningSec` before a transition starts. */
  warning: boolean;
}

export interface TimelineMark {
  atMs: number;
  type: "warning" | "transitionStart" | "transitionEnd";
  phaseIndex: number;
}

interface Step {
  holdMs: number;
  transMs: number;
  target: Circle;
}

interface Plan {
  kind: "shrinking" | "moving";
  delayMs: number;
  warningMs: number;
  start: Circle;
  steps: Step[];
}

function planOf(main: Zone): Plan | null {
  const b = main.behavior;
  if (main.type !== "main" || b.kind === "static") return null;
  const steps: Step[] =
    b.kind === "shrinking"
      ? b.phases.map((p) => ({ holdMs: p.holdSec * 1000, transMs: p.shrinkSec * 1000, target: { center: p.center, radiusM: p.radiusM } }))
      : b.waypoints.map((w) => ({ holdMs: w.holdSec * 1000, transMs: w.moveSec * 1000, target: { center: w.center, radiusM: w.radiusM } }));
  return { kind: b.kind, delayMs: b.startDelaySec * 1000, warningMs: b.warningSec * 1000, start: enclosingCircle(main.shape), steps };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpCircle = (a: Circle, b: Circle, t: number): Circle => ({
  center: [lerp(a.center[0], b.center[0], t), lerp(a.center[1], b.center[1], t)],
  radiusM: lerp(a.radiusM, b.radiusM, t),
});

/** Transition windows in elapsed-active ms: [start, end) per step. */
function windows(plan: Plan): Array<{ start: number; end: number; from: Circle; to: Circle }> {
  let t = plan.delayMs;
  let cur = plan.start;
  return plan.steps.map((s) => {
    const start = t + s.holdMs;
    const end = start + s.transMs;
    const w = { start, end, from: cur, to: s.target };
    t = end;
    cur = s.target;
    return w;
  });
}

/**
 * Pure state of the main zone at `elapsedActiveMs` (time since seekers were released, pauses excluded).
 * Every step: hold the current circle for holdSec, then move/shrink linearly to its target.
 * The starting circle is the approved area's enclosing circle.
 */
export function zoneStateAt(main: Zone, elapsedActiveMs: number): ZoneTimelineState {
  const plan = planOf(main);
  if (!plan) {
    return { kind: "static", phase: "static", phaseIndex: -1, phaseCount: 0, circle: null, nextCircle: null, progress: 0, msUntilNextChange: null, warning: false };
  }
  const e = Math.max(0, elapsedActiveMs);
  const ws = windows(plan);
  const base = { kind: plan.kind, phaseCount: ws.length } as const;

  for (let i = 0; i < ws.length; i++) {
    const w = ws[i];
    if (e < w.start) {
      return {
        ...base,
        phase: i === 0 && e < plan.delayMs ? "delay" : "hold",
        phaseIndex: i,
        circle: w.from,
        nextCircle: w.to,
        progress: 0,
        msUntilNextChange: w.start - e,
        warning: w.start - e <= plan.warningMs,
      };
    }
    if (e < w.end) {
      const progress = (e - w.start) / (w.end - w.start);
      return { ...base, phase: "transition", phaseIndex: i, circle: lerpCircle(w.from, w.to, progress), nextCircle: w.to, progress, msUntilNextChange: w.end - e, warning: false };
    }
  }
  return { ...base, phase: "final", phaseIndex: ws.length, circle: ws[ws.length - 1].to, nextCircle: null, progress: 0, msUntilNextChange: null, warning: false };
}

/** Moments the runtime turns into events (warning / start / end of each transition), sorted. */
export function timelineMarks(main: Zone): TimelineMark[] {
  const plan = planOf(main);
  if (!plan) return [];
  const marks: TimelineMark[] = [];
  windows(plan).forEach((w, phaseIndex) => {
    if (plan.warningMs > 0) marks.push({ atMs: Math.max(0, w.start - plan.warningMs), type: "warning", phaseIndex });
    marks.push({ atMs: w.start, type: "transitionStart", phaseIndex });
    marks.push({ atMs: w.end, type: "transitionEnd", phaseIndex });
  });
  return marks.sort((a, b) => a.atMs - b.atMs);
}

/** Elapsed-active ms when the last transition ends (0 for static). */
export function timelineTotalMs(main: Zone): number {
  const plan = planOf(main);
  if (!plan) return 0;
  const ws = windows(plan);
  return ws.length ? ws[ws.length - 1].end : plan.delayMs;
}

/** Effective play area = approved area ∩ current circle. */
export function effectiveAreaAt(main: Zone, elapsedActiveMs: number) {
  return { approved: main.shape, circle: zoneStateAt(main, elapsedActiveMs).circle };
}

/**
 * Signed metres to the effective boundary (negative inside). For an intersection the max of the
 * two signed distances is exact for inside/outside and a close lower bound outside.
 */
export function effectiveSignedDistanceM(main: Zone, p: LngLat, elapsedActiveMs: number): number {
  const d = signedDistanceM(p, main.shape);
  const circle = zoneStateAt(main, elapsedActiveMs).circle;
  return circle ? Math.max(d, distanceM(p, circle.center) - circle.radiusM) : d;
}
