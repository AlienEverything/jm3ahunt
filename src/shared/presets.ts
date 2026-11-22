import { deepMerge, DEFAULT_SETTINGS } from "./defaults";
import type { Settings } from "./schemas/settings";
import type { RelativeShrinkTemplate } from "./zones/build";

export interface BuiltInPreset {
  id: "classic" | "manhunt_jail" | "shrinking_hunt" | "casual";
  nameKey: string;
  descriptionKey: string;
  settings: Settings;
  /** Applied to the main zone with buildShrinkBehavior() once the host has drawn the area. */
  mainShrink?: RelativeShrinkTemplate;
  /** Zone types the host must add before starting (e.g. a jail). */
  requiresZones?: Array<"jail">;
}

const preset = (p: Omit<BuiltInPreset, "settings"> & { patch: Parameters<typeof deepMerge>[1] }): BuiltInPreset => {
  const { patch, ...rest } = p;
  return { ...rest, settings: deepMerge(DEFAULT_SETTINGS, patch) };
};

export const BUILT_IN_PRESETS: readonly BuiltInPreset[] = [
  preset({
    id: "classic",
    nameKey: "presets.classic.name",
    descriptionKey: "presets.classic.description",
    patch: {
      timing: { durationMin: 30 },
      visibility: { pings: { enabled: true, precision: "approx", intervalSec: 300 } },
      capture: { outcome: "convert" },
    },
  }),
  preset({
    id: "manhunt_jail",
    nameKey: "presets.manhunt_jail.name",
    descriptionKey: "presets.manhunt_jail.description",
    requiresZones: ["jail"],
    patch: {
      visibility: { pings: { enabled: true, precision: "approx", intervalSec: 240, firstPingAfterSec: 240 } },
      capture: { outcome: "jail" },
      jail: { maxJailSec: 300, rescue: { enabled: true, method: "confirm", maxRescues: 3, cooldownSec: 60 } },
    },
  }),
  preset({
    id: "shrinking_hunt",
    nameKey: "presets.shrinking_hunt.name",
    descriptionKey: "presets.shrinking_hunt.description",
    patch: {
      timing: { durationMin: 30 },
      visibility: { pings: { enabled: true, precision: "approx", intervalSec: 180, firstPingAfterSec: 180 } },
      capture: { outcome: "convert" },
      boundary: { penalty: "reveal" },
    },
    mainShrink: {
      startDelaySec: 300,
      warningSec: 60,
      steps: [
        { holdSec: 0, shrinkSec: 120, radiusFrac: 0.7 },
        { holdSec: 300, shrinkSec: 120, radiusFrac: 0.45 },
        { holdSec: 300, shrinkSec: 120, radiusFrac: 0.25 },
      ],
    },
  }),
  preset({
    id: "casual",
    nameKey: "presets.casual.name",
    descriptionKey: "presets.casual.description",
    patch: {
      timing: { durationMin: 20, hidingSec: 180 },
      visibility: { pings: { enabled: false } },
      capture: { outcome: "convert" },
    },
  }),
];

export const getBuiltInPreset = (id: string) => BUILT_IN_PRESETS.find((p) => p.id === id);
