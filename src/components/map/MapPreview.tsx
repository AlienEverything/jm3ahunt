"use client";

import { Map as MapIcon } from "lucide-react";
import type { Zone } from "@/shared";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { BaseMap } from "./BaseMap";
import { ZoneLayers } from "./ZoneLayers";
import { zonesBounds } from "./zoneStyle";

export interface MapPreviewProps {
  zones: readonly Zone[];
  className?: string;
}

/** Static, non-interactive map of the play area (lobby, setup summary). */
export function MapPreview({ zones, className }: MapPreviewProps) {
  const bounds = zonesBounds(zones);
  if (!bounds) {
    return (
      <div className={cn("flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed bg-muted/50 p-6 text-center", className)}>
        <MapIcon aria-hidden className="size-6 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{t("map.noZones")}</p>
      </div>
    );
  }
  const names = zones.filter((z) => z.enabled).map((z) => z.name || t(`zoneTypes.${z.type}`));
  return (
    <figure className={cn("flex flex-col gap-2", className)}>
      <BaseMap key={JSON.stringify(bounds)} interactive={false} initial={{ bounds, padding: 24 }} label={t("map.previewLabel")} className="aspect-[4/3] w-full rounded-2xl border">
        <ZoneLayers zones={zones} prefix="jh-preview" labels={false} />
      </BaseMap>
      <figcaption className="text-xs text-pretty text-muted-foreground">{names.join(" · ")}</figcaption>
    </figure>
  );
}
