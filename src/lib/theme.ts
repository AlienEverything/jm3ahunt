"use client";

import { useSyncExternalStore } from "react";
import { THEME_KEY, type ThemePref } from "./theme-script";

export type { ThemePref };

const listeners = new Set<() => void>();
const media = () => window.matchMedia("(prefers-color-scheme: dark)");

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function apply(pref: ThemePref) {
  const dark = pref === "dark" || (pref === "system" && media().matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function setThemePref(pref: ThemePref) {
  try {
    if (pref === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, pref);
  } catch {
    // Storage blocked: theme still applies for this page view.
  }
  apply(pref);
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onMedia = () => {
    if (readPref() === "system") apply("system");
    cb();
  };
  media().addEventListener("change", onMedia);
  return () => {
    listeners.delete(cb);
    media().removeEventListener("change", onMedia);
  };
}

/** Stored preference and the theme actually shown. */
export function useTheme(): { pref: ThemePref; resolved: "light" | "dark" } {
  const pref = useSyncExternalStore(subscribe, readPref, () => "system" as ThemePref);
  const dark = useSyncExternalStore(
    subscribe,
    () => document.documentElement.classList.contains("dark"),
    () => false,
  );
  return { pref, resolved: dark ? "dark" : "light" };
}
