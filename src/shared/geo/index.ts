import {
  area as turfArea,
  booleanIntersects,
  booleanPointInPolygon,
  booleanWithin,
  centroid as turfCentroid,
  kinks,
  lineString,
  point as turfPoint,
  pointToLineDistance,
  polygon as turfPolygon,
} from "@turf/turf";
import type { LngLat, ZoneShape } from "../schemas/zones";

export const EARTH_RADIUS_M = 6_371_008.8;
const RAD = Math.PI / 180;

export interface LatLng {
  lat: number;
  lng: number;
}

export const toLngLat = (p: LatLng): LngLat => [p.lng, p.lat];
export const toLatLng = ([lng, lat]: LngLat): LatLng => ({ lat, lng });

/** Great-circle distance in metres (haversine). */
export function distanceM(a: LngLat, b: LngLat): number {
  const dLat = (b[1] - a[1]) * RAD;
  const dLng = (b[0] - a[0]) * RAD;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Point reached from `origin` after `distM` metres on `bearingDeg` (0 = north, clockwise). */
export function destination(origin: LngLat, distM: number, bearingDeg: number): LngLat {
  const δ = distM / EARTH_RADIUS_M;
  const θ = bearingDeg * RAD;
  const φ1 = origin[1] * RAD;
  const λ1 = origin[0] * RAD;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return [((λ2 / RAD + 540) % 360) - 180, φ2 / RAD];
}

/** Closed ring approximating a circle. */
export function circleToPolygon(center: LngLat, radiusM: number, steps = 64): LngLat[] {
  const ring: LngLat[] = [];
  for (let i = 0; i < steps; i++) ring.push(destination(center, radiusM, (360 * i) / steps));
  ring.push(ring[0]);
  return ring;
}

const samePoint = (a: LngLat, b: LngLat) => a[0] === b[0] && a[1] === b[1];

export function closeRing(ring: LngLat[]): LngLat[] {
  return ring.length && !samePoint(ring[0], ring[ring.length - 1]) ? [...ring, ring[0]] : ring;
}

export function openRing(ring: LngLat[]): LngLat[] {
  return ring.length > 1 && samePoint(ring[0], ring[ring.length - 1]) ? ring.slice(0, -1) : ring;
}

const asPolygon = (ring: LngLat[]) => turfPolygon([closeRing(ring)]);

/** Polygon problems: fewer than 3 distinct points, self-intersection, zero area. Empty = valid. */
export function polygonIssues(ring: LngLat[]): Array<"tooFewPoints" | "selfIntersecting" | "zeroArea"> {
  const distinct = new Set(openRing(ring).map((p) => `${p[0]},${p[1]}`));
  if (distinct.size < 3) return ["tooFewPoints"];
  const issues: Array<"selfIntersecting" | "zeroArea"> = [];
  const poly = asPolygon(ring);
  if (kinks(poly).features.length > 0) issues.push("selfIntersecting");
  if (turfArea(poly) < 1) issues.push("zeroArea");
  return issues;
}

export function shapeToRing(shape: ZoneShape, steps = 64): LngLat[] {
  return shape.kind === "circle" ? circleToPolygon(shape.center, shape.radiusM, steps) : closeRing(shape.ring);
}

export function pointInShape(p: LngLat, shape: ZoneShape): boolean {
  if (shape.kind === "circle") return distanceM(p, shape.center) <= shape.radiusM;
  return booleanPointInPolygon(turfPoint(p), asPolygon(shape.ring));
}

/** Metres to the shape boundary: negative inside, positive outside. */
export function signedDistanceM(p: LngLat, shape: ZoneShape): number {
  if (shape.kind === "circle") return distanceM(p, shape.center) - shape.radiusM;
  const d = pointToLineDistance(turfPoint(p), lineString(closeRing(shape.ring)), { units: "meters" });
  return pointInShape(p, shape) ? -d : d;
}

export function shapeCenter(shape: ZoneShape): LngLat {
  if (shape.kind === "circle") return shape.center;
  return turfCentroid(asPolygon(shape.ring)).geometry.coordinates as LngLat;
}

/** A circle that contains the whole shape (the shape itself for circles). */
export function enclosingCircle(shape: ZoneShape): { center: LngLat; radiusM: number } {
  if (shape.kind === "circle") return { center: shape.center, radiusM: shape.radiusM };
  const center = shapeCenter(shape);
  const radiusM = Math.max(...openRing(shape.ring).map((v) => distanceM(center, v)));
  return { center, radiusM };
}

/** Largest radius of a circle at `center` that fits in the shape (0 if center is outside). */
export function inscribedRadiusAt(shape: ZoneShape, center: LngLat): number {
  return Math.max(0, -signedDistanceM(center, shape));
}

/** Circle fully inside shape. `epsM` absorbs floating-point noise. */
export function circleWithinShape(center: LngLat, radiusM: number, shape: ZoneShape, epsM = 0.5): boolean {
  if (shape.kind === "circle") return distanceM(center, shape.center) + radiusM <= shape.radiusM + epsM;
  return pointInShape(center, shape) && -signedDistanceM(center, shape) + epsM >= radiusM;
}

/** `inner` fully inside `outer`. */
export function shapeWithinShape(inner: ZoneShape, outer: ZoneShape): boolean {
  if (inner.kind === "circle") return circleWithinShape(inner.center, inner.radiusM, outer);
  if (outer.kind === "circle") return openRing(inner.ring).every((v) => distanceM(v, outer.center) <= outer.radiusM + 0.5);
  return booleanWithin(asPolygon(inner.ring), asPolygon(outer.ring));
}

/** Shapes overlap or touch. */
export function shapesIntersect(a: ZoneShape, b: ZoneShape): boolean {
  if (a.kind === "circle" && b.kind === "circle") return distanceM(a.center, b.center) <= a.radiusM + b.radiusM;
  if (a.kind === "circle") return signedDistanceM(a.center, b) <= a.radiusM;
  if (b.kind === "circle") return signedDistanceM(b.center, a) <= b.radiusM;
  return booleanIntersects(asPolygon(a.ring), asPolygon(b.ring));
}
