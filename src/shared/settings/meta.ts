import { DEFAULT_SETTINGS } from "../defaults";
import type { Settings } from "../schemas/settings";

type Leaf = string | number | boolean | readonly unknown[];
type Paths<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends Leaf ? `${P}${K}` : Paths<T[K], `${P}${K}.`>;
}[keyof T & string];

/** Every editable leaf of Settings, as a dotted path. */
export type SettingPath = Exclude<Paths<Settings>, "mode">;

export const SETTINGS_GROUPS = [
  "general",
  "timing",
  "roles",
  "zones",
  "visibility",
  "capture",
  "jail",
  "victory",
  "boundaries",
  "notifications",
] as const;
export type SettingsGroup = (typeof SETTINGS_GROUPS)[number];
export const groupLabelKey = (g: SettingsGroup) => `settings.groups.${g}`;

export type SettingControl = "toggle" | "number" | "duration" | "select" | "segmented" | "slider" | "multiselect";
export type SettingUnit = "sec" | "min" | "m" | "mps" | "points" | "players";

export interface SettingOption {
  value: string;
  labelKey: string;
}

export interface SettingField {
  path: SettingPath;
  group: SettingsGroup;
  /** Hidden behind "Advanced" in the settings UI. */
  advanced: boolean;
  labelKey: string;
  helpKey: string;
  control: SettingControl;
  /** Unit the value is stored in (duration controls convert for display). */
  unit?: SettingUnit;
  min?: number;
  max?: number;
  step?: number;
  options?: SettingOption[];
  /** Recommended default (DEFAULT_SETTINGS value). */
  recommended: unknown;
  /** Field is relevant only when this returns true; hide it otherwise. */
  dependsOn?: (s: Settings) => boolean;
}

export function getAt(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
}

/** Immutable set of a dotted path. */
export function setAt<T>(obj: T, path: string, value: unknown): T {
  const [head, ...rest] = path.split(".");
  const src = (obj ?? {}) as Record<string, unknown>;
  return { ...src, [head]: rest.length ? setAt(src[head], rest.join("."), value) : value } as T;
}

type FieldSpec = Omit<SettingField, "labelKey" | "helpKey" | "recommended" | "options"> & { options?: readonly string[] };

const pingsOn = (s: Settings) => s.visibility.pings.enabled;
const jailOn = (s: Settings) => s.capture.outcome === "jail";
const rescueOn = (s: Settings) => jailOn(s) && s.jail.rescue.enabled;
const pointsOn = (s: Settings) => s.victory.mode === "points";

const SPECS: FieldSpec[] = [
  { path: "general.maxPlayers", group: "general", advanced: false, control: "number", unit: "players", min: 2, max: 50, step: 1 },
  { path: "general.minPlayers", group: "general", advanced: true, control: "number", unit: "players", min: 2, max: 50, step: 1 },
  { path: "simulation", group: "general", advanced: true, control: "toggle" },

  { path: "timing.durationMin", group: "timing", advanced: false, control: "duration", unit: "min", min: 1, max: 600, step: 5 },
  { path: "timing.hidingSec", group: "timing", advanced: false, control: "duration", unit: "sec", min: 0, max: 3600, step: 30 },
  { path: "timing.countdownSec", group: "timing", advanced: true, control: "duration", unit: "sec", min: 5, max: 120, step: 5 },
  { path: "timing.overtimeSec", group: "timing", advanced: true, control: "duration", unit: "sec", min: 0, max: 1800, step: 30 },

  { path: "roles.assignment", group: "roles", advanced: false, control: "segmented", options: ["random", "manual"] },
  { path: "roles.seekerCount", group: "roles", advanced: false, control: "number", unit: "players", min: 1, max: 49, step: 1, dependsOn: (s) => s.roles.assignment === "random" },

  { path: "visibility.pings.enabled", group: "visibility", advanced: false, control: "toggle" },
  { path: "visibility.pings.precision", group: "visibility", advanced: false, control: "segmented", options: ["approx", "exact"], dependsOn: pingsOn },
  { path: "visibility.pings.intervalSec", group: "visibility", advanced: false, control: "duration", unit: "sec", min: 30, max: 3600, step: 30, dependsOn: pingsOn },
  { path: "visibility.pings.approxRadiusM", group: "visibility", advanced: true, control: "slider", unit: "m", min: 25, max: 2000, step: 25, dependsOn: (s) => pingsOn(s) && s.visibility.pings.precision === "approx" },
  { path: "visibility.pings.firstPingAfterSec", group: "visibility", advanced: true, control: "duration", unit: "sec", min: 0, max: 36_000, step: 30, dependsOn: pingsOn },
  { path: "visibility.pings.reciprocal", group: "visibility", advanced: true, control: "toggle", dependsOn: pingsOn },
  { path: "visibility.pings.finalRevealMin", group: "visibility", advanced: true, control: "duration", unit: "min", min: 0, max: 600, step: 1 },
  { path: "visibility.seekersSeeSeekers", group: "visibility", advanced: true, control: "toggle" },
  { path: "visibility.hidersSeeHiders", group: "visibility", advanced: true, control: "toggle" },

  { path: "capture.methods", group: "capture", advanced: false, control: "multiselect", options: ["mutual", "qr", "code"] },
  { path: "capture.outcome", group: "capture", advanced: false, control: "select", options: ["convert", "eliminate", "jail", "freeze"] },
  { path: "capture.freezeSec", group: "capture", advanced: false, control: "duration", unit: "sec", min: 10, max: 3600, step: 10, dependsOn: (s) => s.capture.outcome === "freeze" },
  { path: "capture.confirmTimeoutSec", group: "capture", advanced: true, control: "duration", unit: "sec", min: 10, max: 600, step: 10, dependsOn: (s) => s.capture.methods.includes("mutual") },
  { path: "capture.proximity", group: "capture", advanced: true, control: "segmented", options: ["off", "warn"] },
  { path: "capture.maxTagDistanceM", group: "capture", advanced: true, control: "number", unit: "m", min: 1, max: 500, step: 1, dependsOn: (s) => s.capture.proximity === "warn" },

  { path: "jail.maxJailSec", group: "jail", advanced: false, control: "duration", unit: "sec", min: 0, max: 36_000, step: 30, dependsOn: jailOn },
  { path: "jail.rescue.enabled", group: "jail", advanced: false, control: "toggle", dependsOn: jailOn },
  { path: "jail.rescue.method", group: "jail", advanced: true, control: "segmented", options: ["confirm", "qr"], dependsOn: rescueOn },
  { path: "jail.rescue.maxRescues", group: "jail", advanced: true, control: "number", min: 1, max: 50, step: 1, dependsOn: rescueOn },
  { path: "jail.rescue.cooldownSec", group: "jail", advanced: true, control: "duration", unit: "sec", min: 0, max: 3600, step: 10, dependsOn: rescueOn },

  { path: "victory.mode", group: "victory", advanced: false, control: "segmented", options: ["standard", "points"] },
  { path: "victory.pointsPerCapture", group: "victory", advanced: true, control: "number", unit: "points", min: 0, max: 1000, step: 1, dependsOn: pointsOn },
  { path: "victory.pointsPerMinute", group: "victory", advanced: true, control: "number", unit: "points", min: 0, max: 1000, step: 1, dependsOn: pointsOn },
  { path: "victory.tieBreak", group: "victory", advanced: true, control: "select", options: ["hiders", "seekers", "draw"], dependsOn: pointsOn },

  { path: "boundary.penalty", group: "boundaries", advanced: false, control: "select", options: ["warn_only", "reveal", "eliminate", "host_review"] },
  { path: "boundary.toleranceM", group: "boundaries", advanced: true, control: "number", unit: "m", min: 0, max: 200, step: 5 },
  { path: "boundary.debounceSec", group: "boundaries", advanced: true, control: "duration", unit: "sec", min: 5, max: 600, step: 5 },
  { path: "boundary.graceSec", group: "boundaries", advanced: true, control: "duration", unit: "sec", min: 0, max: 1800, step: 5 },
  { path: "location.maxAccuracyM", group: "boundaries", advanced: true, control: "number", unit: "m", min: 5, max: 500, step: 5 },
  { path: "location.staleAfterSec", group: "boundaries", advanced: true, control: "duration", unit: "sec", min: 15, max: 600, step: 5 },
  { path: "location.maxSpeedMps", group: "boundaries", advanced: true, control: "number", unit: "mps", min: 2, max: 100, step: 1 },
  { path: "disconnect.offlineAfterSec", group: "boundaries", advanced: true, control: "duration", unit: "sec", min: 5, max: 600, step: 5 },

  { path: "notifications.gameStart", group: "notifications", advanced: false, control: "toggle" },
  { path: "notifications.zoneShrink", group: "notifications", advanced: false, control: "toggle" },
  { path: "notifications.playerTagged", group: "notifications", advanced: false, control: "toggle" },
  { path: "notifications.matchEnding", group: "notifications", advanced: false, control: "toggle" },
  { path: "notifications.locationUnavailable", group: "notifications", advanced: false, control: "toggle" },
  { path: "notifications.vibrate", group: "notifications", advanced: false, control: "toggle" },
];

/** Field registry driving the generic settings UI, in display order. */
export const SETTINGS_FIELDS: readonly SettingField[] = SPECS.map(({ options, ...f }) => ({
  ...f,
  labelKey: `settings.${f.path}.label`,
  helpKey: `settings.${f.path}.help`,
  recommended: getAt(DEFAULT_SETTINGS, f.path),
  ...(options ? { options: options.map((value) => ({ value, labelKey: `settings.${f.path}.options.${value}` })) } : {}),
}));

export const fieldByPath = (path: string) => SETTINGS_FIELDS.find((f) => f.path === path);

/** Visible fields for a group, honouring dependsOn and the advanced toggle. */
export function visibleFields(s: Settings, group: SettingsGroup, showAdvanced: boolean): SettingField[] {
  return SETTINGS_FIELDS.filter((f) => f.group === group && (showAdvanced || !f.advanced) && (!f.dependsOn || f.dependsOn(s)));
}
