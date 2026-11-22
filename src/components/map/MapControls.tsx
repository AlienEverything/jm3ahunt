"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Compass, Layers, LocateFixed, Minus, Navigation, Plus } from "lucide-react";
import type { LngLat } from "@/shared";
import { Sheet } from "@/components/common/Sheet";
import { Switch } from "@/components/ui/switch";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { hasImageryKey, useMapCtx, type MapStyleId } from "./BaseMap";

export const CTRL_BTN =
  "pointer-events-auto flex size-11 items-center justify-center rounded-xl border bg-background/92 text-foreground shadow-sm backdrop-blur outline-none transition-[background-color,transform] duration-150 active:scale-[0.96] focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50";

export type LayerKey = "zones" | "players" | "pings";

interface MapControlsProps {
  styleId: MapStyleId;
  onStyle: (id: MapStyleId) => void;
  me?: LngLat | null;
  follow?: boolean;
  onFollow?: (on: boolean) => void;
  layers?: Partial<Record<LayerKey, boolean>>;
  onLayer?: (key: LayerKey, on: boolean) => void;
  className?: string;
  /** Extra buttons above the stack (e.g. sim tools). */
  extra?: ReactNode;
}

/** Bottom-end control stack, ≥ 44 px targets. */
export function MapControls({ styleId, onStyle, me, follow, onFollow, layers, onLayer, className, extra }: MapControlsProps) {
  const { map } = useMapCtx();
  const [bearing, setBearing] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!map) return;
    const onRotate = () => setBearing(map.getBearing());
    map.on("rotate", onRotate);
    return () => {
      map.off("rotate", onRotate);
    };
  }, [map]);

  return (
    <div className={cn("pointer-events-none flex flex-col items-end gap-2", className)}>
      {extra}
      <button type="button" className={CTRL_BTN} onClick={() => setOpen(true)} aria-label={t("map.controls.layers")} aria-haspopup="dialog">
        <Layers aria-hidden className="size-5" />
      </button>
      <button type="button" className={CTRL_BTN} onClick={() => map?.easeTo({ bearing: 0, duration: 250 })} aria-label={t("map.controls.north")}>
        <Compass aria-hidden className="size-5" style={{ transform: `rotate(${-bearing - 45}deg)` }} />
      </button>
      <div className="pointer-events-auto flex flex-col overflow-hidden rounded-xl border bg-background/92 shadow-sm backdrop-blur">
        <button type="button" className="flex size-11 items-center justify-center outline-none focus-visible:bg-muted active:bg-muted" onClick={() => map?.zoomIn({ duration: 200 })} aria-label={t("map.controls.zoomIn")}>
          <Plus aria-hidden className="size-5" />
        </button>
        <span aria-hidden className="mx-2 h-px bg-border" />
        <button type="button" className="flex size-11 items-center justify-center outline-none focus-visible:bg-muted active:bg-muted" onClick={() => map?.zoomOut({ duration: 200 })} aria-label={t("map.controls.zoomOut")}>
          <Minus aria-hidden className="size-5" />
        </button>
      </div>
      {onFollow && (
        <button type="button" className={cn(CTRL_BTN, follow && "border-primary bg-primary text-primary-foreground")} onClick={() => onFollow(!follow)} aria-pressed={!!follow} aria-label={t("map.controls.follow")} disabled={!me}>
          <Navigation aria-hidden className="size-5" />
        </button>
      )}
      <button type="button" className={CTRL_BTN} onClick={() => me && map?.easeTo({ center: me, zoom: Math.max(map.getZoom(), 16), duration: 400 })} aria-label={t("map.controls.center")} disabled={!me}>
        <LocateFixed aria-hidden className="size-5" />
      </button>

      <Sheet open={open} onOpenChange={setOpen} title={t("map.controls.layers")}>
        <div className="flex flex-col gap-5">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">{t("map.style.title")}</legend>
            <div className="grid grid-cols-3 gap-2">
              {(["street", "satellite", "hybrid"] as const).map((id) => (
                <label
                  key={id}
                  className={cn(
                    "flex min-h-11 cursor-pointer items-center justify-center rounded-xl border px-2 text-sm font-medium has-checked:border-primary has-checked:bg-primary/10 has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
                    id !== "street" && !hasImageryKey && "cursor-not-allowed opacity-50",
                  )}
                >
                  <input type="radio" className="sr-only" name="map-style" checked={styleId === id} disabled={id !== "street" && !hasImageryKey} onChange={() => onStyle(id)} />
                  {t(`map.style.${id}`)}
                </label>
              ))}
            </div>
            {!hasImageryKey && <p className="text-xs text-muted-foreground">{t("map.style.noKey")}</p>}
          </fieldset>
          {layers && onLayer && (
            <fieldset className="flex flex-col divide-y rounded-2xl border">
              <legend className="mb-2 text-sm font-medium">{t("map.layers.title")}</legend>
              {(Object.keys(layers) as LayerKey[]).map((k) => (
                <label key={k} className="flex min-h-12 items-center justify-between gap-3 px-4 text-sm">
                  {t(`map.layers.${k}`)}
                  <Switch checked={!!layers[k]} onCheckedChange={(v) => onLayer(k, v)} />
                </label>
              ))}
            </fieldset>
          )}
        </div>
      </Sheet>
    </div>
  );
}
