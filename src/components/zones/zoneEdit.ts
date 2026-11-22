// Pure zone-editing helpers (no React, no map). Unit-tested in zoneEdit.test.ts.
import { destination, distanceM, inscribedRadiusAt, openRing, shapeCenter, type LngLat, type Role, type Zone, type ZoneBehavior, type ZoneShape, type ZoneType } from "@/shared";
import { ZONE_LOOK } from "@/components/map/zoneStyle";

export const newId = () => `z${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;

export function makeZone(type: ZoneType, shape: ZoneShape, name: string): Zone {
  return {
    id: newId(),
    type,
    name,
    color: ZONE_LOOK[type].color,
    opacity: ZONE_LOOK[type].opacity,
    shape,
    enabled: true,
    visibleTo: ["seeker", "hider"] satisfies Role[],
    behavior: { kind: "static" },
  };
}

/** Axis-aligned rectangle centred on `c` (half-sizes in metres), as an open ring. */
export function rectangleAt(c: LngLat, halfW: number, halfH: number): LngLat[] {
  const n = destination(c, halfH, 0)[1];
  const s = destination(c, halfH, 180)[1];
  const e = destination(c, halfW, 90)[0];
  const w = destination(c, halfW, 270)[0];
  return [
    [w, n],
    [e, n],
    [e, s],
    [w, s],
  ];
}

/** Move a shape so its centre lands on `to` (degree delta; fine at play-area scale). */
export function moveShape(shape: ZoneShape, from: LngLat, to: LngLat): ZoneShape {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  if (shape.kind === "circle") return { ...shape, center: [shape.center[0] + dx, shape.center[1] + dy] };
  return { kind: "polygon", ring: openRing(shape.ring).map(([x, y]) => [x + dx, y + dy] as LngLat) };
}

/** Shrink/move targets follow the main zone when it moves. */
export function moveBehavior(b: ZoneBehavior, from: LngLat, to: LngLat): ZoneBehavior {
  const shift = (c: LngLat): LngLat => [c[0] + to[0] - from[0], c[1] + to[1] - from[1]];
  if (b.kind === "shrinking") return { ...b, phases: b.phases.map((p) => ({ ...p, center: shift(p.center) })) };
  if (b.kind === "moving") return { ...b, waypoints: b.waypoints.map((w) => ({ ...w, center: shift(w.center) })) };
  return b;
}

/** Midpoint of each polygon edge (insert handles). */
export function midpoints(ring: LngLat[]): LngLat[] {
  const r = openRing(ring);
  return r.map((p, i) => {
    const q = r[(i + 1) % r.length];
    return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2] as LngLat;
  });
}

export const insertVertex = (ring: LngLat[], afterIndex: number, p: LngLat): LngLat[] => {
  const r = openRing(ring);
  return [...r.slice(0, afterIndex + 1), p, ...r.slice(afterIndex + 1)];
};

export const removeVertex = (ring: LngLat[], index: number): LngLat[] => {
  const r = openRing(ring);
  return r.length <= 3 ? r : r.filter((_, i) => i !== index);
};

export const replaceVertex = (ring: LngLat[], index: number, p: LngLat): LngLat[] => openRing(ring).map((v, i) => (i === index ? p : v));

/** Radius handle sits due east of the centre. */
export const radiusHandle = (center: LngLat, radiusM: number): LngLat => destination(center, radiusM, 90);
export const radiusFrom = (center: LngLat, p: LngLat) => Math.max(1, Math.round(distanceM(center, p)));

/** A sensible next stage: same centre as the last, 60 % (shrink) or 80 % (move) of its radius. */
export function nextStage(main: Zone): { center: LngLat; radiusM: number } {
  const b = main.behavior;
  const list = b.kind === "shrinking" ? b.phases : b.kind === "moving" ? b.waypoints : [];
  const last = list.at(-1);
  if (last) return { center: last.center, radiusM: Math.max(10, Math.round(last.radiusM * (b.kind === "moving" ? 0.8 : 0.6))) };
  const center = shapeCenter(main.shape);
  return { center, radiusM: Math.max(10, Math.round(inscribedRadiusAt(main.shape, center) * 0.7)) };
}

export function withBehaviorKind(main: Zone, kind: ZoneBehavior["kind"]): ZoneBehavior {
  if (kind === "static") return { kind: "static" };
  const b = main.behavior;
  const startDelaySec = b.kind === "static" ? 300 : b.startDelaySec;
  const warningSec = b.kind === "static" ? 60 : b.warningSec;
  const s = nextStage({ ...main, behavior: { kind: "static" } });
  if (kind === "shrinking") return { kind, startDelaySec, warningSec, phases: b.kind === "moving" ? b.waypoints.map((w) => ({ holdSec: w.holdSec, shrinkSec: w.moveSec, center: w.center, radiusM: w.radiusM })) : [{ holdSec: 0, shrinkSec: 120, ...s }] };
  return { kind, startDelaySec, warningSec, waypoints: b.kind === "shrinking" ? b.phases.map((p) => ({ holdSec: p.holdSec, moveSec: p.shrinkSec, center: p.center, radiusM: p.radiusM })) : [{ holdSec: 0, moveSec: 120, ...s }] };
}
