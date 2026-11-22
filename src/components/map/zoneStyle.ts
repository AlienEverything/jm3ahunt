import { Ban, Crosshair, Flag, FlagTriangleRight, LifeBuoy, Lock, MapPinned, ShieldCheck, Star, Target, type LucideIcon } from "lucide-react";
import type { Feature, FeatureCollection, Polygon } from "geojson";
import { circleToPolygon, shapeToRing, type LngLat, type Zone, type ZoneShape, type ZoneType } from "@/shared";

/** Line styles (SPEC §11): zones never rely on colour alone. */
export type Dash = "solid" | "dashed" | "dotted" | "dashdot";

export interface ZoneLook {
  color: string;
  opacity: number;
  dash: Dash;
  icon: LucideIcon;
  /** Restricted zones get a hatched fill on top of the tint. */
  hatch?: boolean;
}

export const ZONE_LOOK: Record<ZoneType, ZoneLook> = {
  main: { color: "#3B82F6", opacity: 0.06, dash: "solid", icon: MapPinned },
  safe: { color: "#16A34A", opacity: 0.18, dash: "dotted", icon: ShieldCheck },
  restricted: { color: "#DC2626", opacity: 0.16, dash: "solid", icon: Ban, hatch: true },
  jail: { color: "#7C3AED", opacity: 0.18, dash: "dashed", icon: Lock },
  rescue: { color: "#0891B2", opacity: 0.18, dash: "dashdot", icon: LifeBuoy },
  spawn: { color: "#64748B", opacity: 0.16, dash: "dashed", icon: Flag },
  objective: { color: "#CA8A04", opacity: 0.18, dash: "dashdot", icon: Star },
  capture: { color: "#CA8A04", opacity: 0.18, dash: "dashdot", icon: Crosshair },
  control: { color: "#4F46E5", opacity: 0.18, dash: "dashdot", icon: Target },
  flag: { color: "#DB2777", opacity: 0.18, dash: "dashdot", icon: FlagTriangleRight },
};

/** line-dasharray is in line widths. */
export const DASH_ARRAY: Record<Exclude<Dash, "solid">, number[]> = {
  dashed: [3, 2],
  dotted: [0.1, 2],
  dashdot: [4, 2, 0.1, 2],
};

export const HATCH_IMAGE = "jh-hatch";

/** 16×16 diagonal hatch (drawn at 2× for crisp lines), red ink with alpha. */
export function makeHatchImage(): { width: number; height: number; data: Uint8Array } {
  const size = 32;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = (x + y) % 16;
      if (d < 3) {
        const i = (y * size + x) * 4;
        data[i] = 220;
        data[i + 1] = 38;
        data[i + 2] = 38;
        data[i + 3] = 190;
      }
    }
  }
  return { width: size, height: size, data };
}

export const ringOf = (shape: ZoneShape): LngLat[] => shapeToRing(shape, 72);

const poly = (ring: LngLat[], props: Record<string, unknown>): Feature<Polygon> => ({ type: "Feature", properties: props, geometry: { type: "Polygon", coordinates: [ring] } });

/** Zones as GeoJSON polygons with the style props the zone layers read. */
export function zonesToGeoJSON(zones: readonly Zone[], opts: { selectedId?: string | null; dimMain?: boolean } = {}): FeatureCollection<Polygon> {
  return {
    type: "FeatureCollection",
    features: zones
      .filter((z) => z.enabled)
      .map((z) =>
        poly(ringOf(z.shape), {
          id: z.id,
          type: z.type,
          color: z.color,
          fill: z.opacity,
          dash: ZONE_LOOK[z.type].dash,
          width: z.type === "main" ? (opts.dimMain ? 1.5 : 3) : 2.5,
          hatch: ZONE_LOOK[z.type].hatch ? 1 : 0,
          selected: z.id === opts.selectedId ? 1 : 0,
        }),
      ),
  };
}

export const circleFeature = (center: LngLat, radiusM: number, props: Record<string, unknown> = {}) => poly(circleToPolygon(center, radiusM, 72), props);

export const fc = <T extends Feature>(features: T[]): FeatureCollection => ({ type: "FeatureCollection", features });

/** Bounds of the enabled zones (or null). */
export function zonesBounds(zones: readonly Zone[]): [LngLat, LngLat] | null {
  const pts = zones.filter((z) => z.enabled).flatMap((z) => ringOf(z.shape));
  if (pts.length === 0) return null;
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of pts) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return [
    [minX, minY],
    [maxX, maxY],
  ];
}
