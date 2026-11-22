"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { setThemePref, useTheme, type ThemePref } from "@/lib/theme";

const NEXT: Record<ThemePref, ThemePref> = { system: "light", light: "dark", dark: "system" };
const ICON = { system: Monitor, light: Sun, dark: Moon } as const;

/** Cycles system → light → dark. */
export function ThemeToggle() {
  const { pref } = useTheme();
  const Icon = ICON[pref];
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setThemePref(NEXT[pref])}
      aria-label={t("theme.toggle", { current: t(`theme.${pref}`) })}
      title={t(`theme.${pref}`)}
    >
      <Icon aria-hidden />
    </Button>
  );
}
