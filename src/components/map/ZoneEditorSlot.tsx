"use client";

import { PencilRuler } from "lucide-react";
import type { Issue, Settings, Zone } from "@/shared";
import { t, tm } from "@/i18n";

export interface ZoneEditorSlotProps {
  zones: Zone[];
  onChange: (zones: Zone[]) => void;
  /** Current rules (timing drives the shrink timeline preview). */
  settings: Settings;
  /** Issues whose path starts with `zones` (from validateSettings with zones). */
  issues: readonly Issue[];
  /** Built-in preset shrink template the editor can offer to apply once a main zone exists. */
  presetId?: string;
}

/**
 * "Play area" step of match setup.
 * Placeholder until task 4 replaces this file with the zone editor (keep the props).
 */
export function ZoneEditorSlot({ zones, issues }: ZoneEditorSlotProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed bg-muted/50 px-6 py-10 text-center">
        <PencilRuler aria-hidden className="size-6 text-muted-foreground" />
        <p className="text-sm font-medium">{t("map.editorPlaceholder")}</p>
        <p className="max-w-sm text-xs text-pretty text-muted-foreground">{t("map.editorPlaceholderBody", { count: zones.length })}</p>
      </div>
      {issues.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {issues.map((i, n) => (
            <li key={n} className={i.severity === "error" ? "text-danger" : "text-warning"}>
              {tm(i)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
