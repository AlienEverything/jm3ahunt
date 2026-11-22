"use client";

import { Map as MapIcon } from "lucide-react";
import type { Zone } from "@/shared";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";

export interface MapPreviewProps {
  zones: readonly Zone[];
  className?: string;
}

/**
 * Read-only map of the play area for the lobby and setup summary.
 * Placeholder until task 4 replaces this file with the MapLibre preview (keep the props).
 */
export function MapPreview({ zones, className }: MapPreviewProps) {
  const enabled = zones.filter((z) => z.enabled);
  return (
    <div className={cn("flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed bg-muted/50 p-6 text-center", className)}>
      <MapIcon aria-hidden className="size-6 text-muted-foreground" />
      <p className="text-sm font-medium">{t("map.previewPlaceholder")}</p>
      <p className="text-xs text-muted-foreground">
        {enabled.length === 0 ? t("map.noZones") : enabled.map((z) => z.name || t(`zoneTypes.${z.type}`)).join(" · ")}
      </p>
    </div>
  );
}
