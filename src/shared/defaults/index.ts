import { SettingsSchema, type Settings, type SettingsPatch } from "../schemas/settings";

export const DEFAULT_SETTINGS: Settings = {
  mode: "hide_seek",
  general: { minPlayers: 2, maxPlayers: 15 },
  timing: { countdownSec: 10, hidingSec: 300, durationMin: 30, overtimeSec: 0 },
  roles: { assignment: "random", seekerCount: 1 },
  visibility: {
    seekersSeeSeekers: true,
    hidersSeeHiders: false,
    pings: {
      enabled: true,
      intervalSec: 300,
      precision: "approx",
      approxRadiusM: 150,
      firstPingAfterSec: 300,
      reciprocal: false,
      finalRevealMin: 0,
    },
  },
  location: { maxAccuracyM: 50, staleAfterSec: 45, maxSpeedMps: 12 },
  boundary: { toleranceM: 10, debounceSec: 20, graceSec: 45, penalty: "warn_only" },
  capture: {
    methods: ["mutual", "qr", "code"],
    confirmTimeoutSec: 60,
    proximity: "warn",
    maxTagDistanceM: 15,
    outcome: "convert",
    freezeSec: 120,
  },
  jail: {
    maxJailSec: 300,
    rescue: { enabled: true, method: "confirm", maxRescues: 3, cooldownSec: 60 },
  },
  victory: { mode: "standard", pointsPerCapture: 10, pointsPerMinute: 1, tieBreak: "hiders" },
  disconnect: { offlineAfterSec: 30 },
  notifications: {
    gameStart: true,
    zoneShrink: true,
    playerTagged: true,
    matchEnding: true,
    locationUnavailable: true,
    vibrate: true,
  },
  simulation: false,
};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Deep merge (arrays replace). Pure: returns a new object. */
export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) return (patch === undefined ? structuredClone(base) : patch) as T;
  const out: Record<string, unknown> = structuredClone(base);
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    out[k] = isPlainObject(out[k]) && isPlainObject(v) ? deepMerge(out[k], v) : structuredClone(v);
  }
  return out as T;
}

/** Fill missing fields from `base` (defaults), then validate. Throws ZodError on bad input. */
export function withDefaults(patch: SettingsPatch | unknown = {}, base: Settings = DEFAULT_SETTINGS): Settings {
  return SettingsSchema.parse(deepMerge(base, patch));
}
