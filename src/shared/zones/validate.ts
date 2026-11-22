import { circleWithinShape, polygonIssues, shapesIntersect, shapeWithinShape } from "../geo";
import type { Zone, ZoneType } from "../schemas/zones";
import type { Issue } from "../types";
import { timelineTotalMs } from "./timeline";

/**
 * Overlap priority (higher wins where zones overlap): restricted > jail (for jailed players) > safe >
 * objective-type zones > main.
 */
export const ZONE_PRIORITY: Record<ZoneType, number> = {
  restricted: 100,
  jail: 90,
  safe: 80,
  capture: 50,
  flag: 50,
  control: 50,
  objective: 50,
  rescue: 50,
  spawn: 50,
  main: 10,
};

export const OBJECTIVE_ZONE_TYPES: readonly ZoneType[] = ["capture", "flag", "control", "objective"];
/** Zones that must sit inside the approved area and clear of restricted zones. */
const INNER_TYPES: readonly ZoneType[] = ["spawn", "jail", "rescue", ...OBJECTIVE_ZONE_TYPES];

export const MIN_RADIUS_M = 10;
export const MAX_RADIUS_M = 20_000;

const issue = (path: string, severity: Issue["severity"], key: string, params?: Issue["params"]): Issue => ({
  path,
  severity,
  key: `issues.zones.${key}`,
  ...(params ? { params } : {}),
});

function radiusIssue(path: string, radiusM: number): Issue | null {
  if (radiusM < MIN_RADIUS_M) return issue(path, "error", "radiusTooSmall", { min: MIN_RADIUS_M });
  if (radiusM > MAX_RADIUS_M) return issue(path, "error", "radiusTooLarge", { max: MAX_RADIUS_M / 1000 });
  return null;
}

/** Main enabled zone (first one), if any. */
export function findMainZone(zones: readonly Zone[]): Zone | undefined {
  return zones.find((z) => z.enabled && z.type === "main");
}

/** SPEC §8 zone validation. Errors block start; warnings are shown. */
export function validateZones(zones: readonly Zone[], ctx: { durationMin?: number } = {}): Issue[] {
  const out: Issue[] = [];
  const validShape = new Set<string>();

  for (const z of zones) {
    const path = `zones.${z.id}`;
    const before = out.length;
    if (z.shape.kind === "circle") {
      const r = radiusIssue(path, z.shape.radiusM);
      if (r) out.push(r);
    } else {
      for (const p of polygonIssues(z.shape.ring)) {
        out.push(issue(path, "error", p === "tooFewPoints" ? "polygonTooFewPoints" : p === "selfIntersecting" ? "polygonSelfIntersecting" : "polygonZeroArea"));
      }
    }
    if (z.type !== "main" && z.behavior.kind !== "static") out.push(issue(path, "error", "behaviorMainOnly"));
    if (out.length === before) validShape.add(z.id);
  }

  const enabled = zones.filter((z) => z.enabled);
  const mains = enabled.filter((z) => z.type === "main");
  if (mains.length === 0) out.push(issue("zones", "error", "noMain"));
  if (mains.length > 1) out.push(issue("zones", "error", "multipleMain"));

  const usable = enabled.filter((z) => validShape.has(z.id));
  const restricted = usable.filter((z) => z.type === "restricted");

  for (const safe of usable.filter((z) => z.type === "safe")) {
    for (const r of restricted) {
      if (shapesIntersect(safe.shape, r.shape)) out.push(issue(`zones.${safe.id}`, "error", "safeIntersectsRestricted", { other: r.name }));
    }
  }
  for (const z of usable.filter((z) => INNER_TYPES.includes(z.type))) {
    for (const r of restricted) {
      if (shapesIntersect(z.shape, r.shape)) out.push(issue(`zones.${z.id}`, "error", "zoneTouchesRestricted", { other: r.name }));
    }
  }

  const main = mains[0];
  if (!main || !validShape.has(main.id)) return out;

  for (const z of usable.filter((z) => INNER_TYPES.includes(z.type))) {
    if (!shapeWithinShape(z.shape, main.shape)) out.push(issue(`zones.${z.id}`, "error", "zoneOutsideArea"));
  }
  for (const r of restricted) {
    if (!shapesIntersect(r.shape, main.shape)) out.push(issue(`zones.${r.id}`, "warning", "restrictedOutsidePlayArea"));
  }

  const b = main.behavior;
  if (b.kind !== "static") {
    const targets = b.kind === "shrinking" ? b.phases : b.waypoints;
    targets.forEach((t, i) => {
      const path = `zones.${main.id}.behavior.${i}`;
      const r = radiusIssue(path, t.radiusM);
      if (r) out.push(r);
      else if (!circleWithinShape(t.center, t.radiusM, main.shape)) out.push(issue(path, "error", "phaseOutsideArea", { n: i + 1 }));
      if (b.kind === "shrinking" && i > 0 && t.radiusM > targets[i - 1].radiusM) {
        out.push(issue(path, "warning", "shrinkRadiusIncreases", { n: i + 1 }));
      }
    });
    if (ctx.durationMin !== undefined && timelineTotalMs(main) > ctx.durationMin * 60_000) {
      out.push(issue(`zones.${main.id}.behavior`, "warning", "timelineExceedsDuration"));
    }
  }
  return out;
}
