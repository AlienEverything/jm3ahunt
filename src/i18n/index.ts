import { en } from "./en";

type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

export type MessageKey = Leaves<typeof en>;
export type MessageParams = Record<string, string | number>;

export const locale = "en";
export const dir: "ltr" | "rtl" = "ltr";
const messages: unknown = en;

function lookup(key: string): string | undefined {
  const v = key.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), messages);
  return typeof v === "string" ? v : undefined;
}

export const hasMessage = (key: string) => lookup(key) !== undefined;

/** 90 → "1 min 30 s", 300 → "5 min", 3600 → "1 h". */
export function formatDuration(totalSec: number): string {
  const sec = Math.max(0, Math.round(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const parts: string[] = [];
  if (h) parts.push(en.units.hours.replace("{n}", String(h)));
  if (m) parts.push(en.units.minutes.replace("{n}", String(m)));
  if (s || parts.length === 0) parts.push(en.units.seconds.replace("{n}", String(s)));
  return parts.join(" ");
}

function interpolate(template: string, params?: MessageParams): string {
  return template.replace(/\{(\w+)(?:\|(\w+))?\}/g, (whole, name: string, fmt?: string) => {
    const v = params?.[name];
    if (v === undefined) return whole;
    if (fmt === "duration" && typeof v === "number") return formatDuration(v);
    return String(v);
  });
}

/** Typed lookup. `{param}` interpolation; `{param|duration}` formats seconds. */
export function t(key: MessageKey, params?: MessageParams): string {
  return interpolate(lookup(key) ?? key, params);
}

/** For keys produced at runtime by src/shared (issues, summary, events). Falls back to the key. */
export function tm(msg: { key: string; params?: MessageParams }): string {
  return interpolate(lookup(msg.key) ?? msg.key, msg.params);
}
