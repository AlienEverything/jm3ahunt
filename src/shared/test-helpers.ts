// Fixtures for unit tests only (not exported from the barrel).
import { DEFAULT_SETTINGS, deepMerge } from "./defaults";
import { destination } from "./geo";
import type { Settings, SettingsPatch } from "./schemas/settings";
import type { LngLat, Zone, ZoneShape } from "./schemas/zones";
import type { LocationFix } from "./types";

export const CENTER: LngLat = [46.6753, 24.7136];

export const settingsWith = (patch: SettingsPatch = {}): Settings => deepMerge(DEFAULT_SETTINGS, patch);

let n = 0;
export function zone(type: Zone["type"], shape: ZoneShape, extra: Partial<Zone> = {}): Zone {
  return {
    id: extra.id ?? `${type}-${++n}`,
    type,
    name: extra.name ?? type,
    color: "#336699",
    opacity: 0.3,
    shape,
    enabled: true,
    visibleTo: ["seeker", "hider"],
    behavior: { kind: "static" },
    ...extra,
  };
}

export const circle = (center: LngLat, radiusM: number): ZoneShape => ({ kind: "circle", center, radiusM });

/** Point `distM` metres from CENTER on `bearing`. */
export const at = (distM: number, bearing = 90, from: LngLat = CENTER): LngLat => destination(from, distM, bearing);

export const fixAt = (p: LngLat, ts: number, acc = 5): LocationFix => ({ lng: p[0], lat: p[1], acc, ts });

export const mainZone = (radiusM = 1000, extra: Partial<Zone> = {}) => zone("main", circle(CENTER, radiusM), { id: "main", ...extra });
