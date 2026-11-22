import { inscribedRadiusAt, pointInShape, shapeCenter, toLngLat, type LatLng } from "../geo";
import type { Zone, ZoneBehavior } from "../schemas/zones";
import { ZONE_PRIORITY } from "./validate";

export interface RelativeShrinkStep {
  holdSec: number;
  shrinkSec: number;
  /** Fraction (0..1) of the largest circle that fits in the approved area around its centre. */
  radiusFrac: number;
}

export interface RelativeShrinkTemplate {
  startDelaySec: number;
  warningSec: number;
  steps: RelativeShrinkStep[];
}

/** Concrete shrinking behaviour centred on the approved area (used by presets). */
export function buildShrinkBehavior(main: Zone, t: RelativeShrinkTemplate): ZoneBehavior {
  const center = shapeCenter(main.shape);
  const maxR = inscribedRadiusAt(main.shape, center);
  return {
    kind: "shrinking",
    startDelaySec: t.startDelaySec,
    warningSec: t.warningSec,
    phases: t.steps.map((s) => ({
      holdSec: s.holdSec,
      shrinkSec: s.shrinkSec,
      center,
      radiusM: Math.round(maxR * s.radiusFrac),
    })),
  };
}

/** Enabled zones containing the point, highest priority first. Jail only counts for jailed players. */
export function zonesAtPoint(zones: readonly Zone[], p: LatLng, opts: { jailed?: boolean } = {}): Zone[] {
  const ll = toLngLat(p);
  return zones
    .filter((z) => z.enabled && (z.type !== "jail" || opts.jailed) && pointInShape(ll, z.shape))
    .sort((a, b) => ZONE_PRIORITY[b.type] - ZONE_PRIORITY[a.type]);
}
