import { z } from "zod";

// Structural bounds only. Rule-level checks with friendly messages live in settings/validate.ts.
const int = (min: number, max: number) => z.number().int().min(min).max(max);

export const CAPTURE_METHODS = ["mutual", "qr", "code"] as const;
export const CAPTURE_OUTCOMES = ["convert", "eliminate", "jail", "freeze"] as const;
export const BOUNDARY_PENALTIES = ["warn_only", "reveal", "eliminate", "host_review"] as const;
export const PING_PRECISIONS = ["approx", "exact"] as const;
export const RESCUE_METHODS = ["confirm", "qr"] as const;
export const VICTORY_MODES = ["standard", "points"] as const;
export const TIE_BREAKS = ["hiders", "seekers", "draw"] as const;
export const ROLE_ASSIGNMENTS = ["random", "manual"] as const;
export const PROXIMITY_MODES = ["off", "warn"] as const;

export const HideSeekSettingsSchema = z.strictObject({
  mode: z.literal("hide_seek"),
  general: z.strictObject({
    minPlayers: int(2, 50),
    maxPlayers: int(2, 50),
  }),
  timing: z.strictObject({
    countdownSec: int(5, 120),
    hidingSec: int(0, 3600),
    durationMin: int(1, 600),
    overtimeSec: int(0, 1800),
  }),
  roles: z.strictObject({
    assignment: z.enum(ROLE_ASSIGNMENTS),
    seekerCount: int(1, 49),
  }),
  visibility: z.strictObject({
    seekersSeeSeekers: z.boolean(),
    hidersSeeHiders: z.boolean(),
    pings: z.strictObject({
      enabled: z.boolean(),
      intervalSec: int(1, 3600),
      precision: z.enum(PING_PRECISIONS),
      approxRadiusM: int(25, 2000),
      firstPingAfterSec: int(0, 36_000),
      /** Seekers are pinged to hiders on the same schedule. */
      reciprocal: z.boolean(),
      /** Last N minutes: opponents see each other's live exact location. 0 = off. */
      finalRevealMin: int(0, 600),
    }),
  }),
  location: z.strictObject({
    maxAccuracyM: int(5, 500),
    staleAfterSec: int(15, 600),
    maxSpeedMps: int(2, 100),
  }),
  boundary: z.strictObject({
    toleranceM: int(0, 200),
    debounceSec: int(5, 600),
    graceSec: int(0, 1800),
    penalty: z.enum(BOUNDARY_PENALTIES),
  }),
  capture: z.strictObject({
    methods: z.array(z.enum(CAPTURE_METHODS)).max(CAPTURE_METHODS.length),
    confirmTimeoutSec: int(10, 600),
    proximity: z.enum(PROXIMITY_MODES),
    maxTagDistanceM: int(1, 500),
    outcome: z.enum(CAPTURE_OUTCOMES),
    freezeSec: int(10, 3600),
  }),
  jail: z.strictObject({
    /** 0 = stays jailed until rescued or the match ends. */
    maxJailSec: int(0, 36_000),
    rescue: z.strictObject({
      enabled: z.boolean(),
      method: z.enum(RESCUE_METHODS),
      /** Rescues each hider may perform per match. */
      maxRescues: int(1, 50),
      /** Seconds a rescuer waits between rescues. */
      cooldownSec: int(0, 3600),
    }),
  }),
  victory: z.strictObject({
    mode: z.enum(VICTORY_MODES),
    pointsPerCapture: int(0, 1000),
    pointsPerMinute: int(0, 1000),
    tieBreak: z.enum(TIE_BREAKS),
  }),
  disconnect: z.strictObject({
    offlineAfterSec: int(5, 600),
  }),
  notifications: z.strictObject({
    gameStart: z.boolean(),
    zoneShrink: z.boolean(),
    playerTagged: z.boolean(),
    matchEnding: z.boolean(),
    locationUnavailable: z.boolean(),
    vibrate: z.boolean(),
  }),
  /** Dev-only: simulated GPS + bots. Server rejects it unless ALLOW_SIM_GPS and not production. */
  simulation: z.boolean(),
});

/** Union point for future modes (CTF, zone control). */
export const SettingsSchema = HideSeekSettingsSchema;

export type HideSeekSettings = z.infer<typeof HideSeekSettingsSchema>;
export type Settings = HideSeekSettings;
export type CaptureMethod = (typeof CAPTURE_METHODS)[number];
export type CaptureOutcome = (typeof CAPTURE_OUTCOMES)[number];
export type BoundaryPenalty = (typeof BOUNDARY_PENALTIES)[number];
export type PingPrecision = (typeof PING_PRECISIONS)[number];
export type RescueMethod = (typeof RESCUE_METHODS)[number];

type DeepPartial<T> = T extends readonly unknown[] ? T : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;
export type SettingsPatch = DeepPartial<Settings>;
