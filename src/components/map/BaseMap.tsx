"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { FeatureCollection } from "geojson";
import type { GeoJSONSource, LayerSpecification, Map as MlMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { LngLat } from "@/shared";
import { t } from "@/i18n";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import type { MapLibre } from "./maplibre";
import { HATCH_IMAGE, makeHatchImage } from "./zoneStyle";

export type MapStyleId = "street" | "satellite" | "hybrid";

const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY ?? "";
/** Satellite and hybrid need a MapTiler key; without one they are disabled (never unlicensed tiles). */
export const hasImageryKey = MAPTILER_KEY.length > 0;

export function styleUrl(id: MapStyleId, dark: boolean): string {
  if (id !== "street" && hasImageryKey) return `https://api.maptiler.com/maps/${id}/style.json?key=${encodeURIComponent(MAPTILER_KEY)}`;
  return `https://tiles.openfreemap.org/styles/${dark ? "dark" : "liberty"}`;
}

const STYLE_KEY = "jh-map-style";
export function readStylePref(): MapStyleId {
  try {
    const v = localStorage.getItem(STYLE_KEY);
    return (v === "satellite" || v === "hybrid") && hasImageryKey ? v : "street";
  } catch {
    return "street";
  }
}
export function saveStylePref(id: MapStyleId) {
  try {
    localStorage.setItem(STYLE_KEY, id);
  } catch {
    // storage blocked: the choice lasts for this page view
  }
}

interface MapCtx {
  map: MlMap | null;
  ml: MapLibre | null;
  /** Bumps on every style load; overlays re-add their sources/layers when it changes. */
  styleVersion: number;
}
const Ctx = createContext<MapCtx>({ map: null, ml: null, styleVersion: 0 });
export const useMapCtx = () => useContext(Ctx);

export type MapInitial = { center: LngLat; zoom: number } | { bounds: [LngLat, LngLat]; padding?: number };

interface BaseMapProps {
  styleId?: MapStyleId;
  interactive?: boolean;
  initial: MapInitial;
  label: string;
  className?: string;
  /** Overlays (layers, markers) and HUD controls; rendered inside the map's box. */
  children?: ReactNode;
  onReady?: (map: MlMap, ml: MapLibre) => void;
}

/** MapLibre map: street (OpenFreeMap, light/dark with the app theme), satellite / hybrid (MapTiler). */
export function BaseMap({ styleId = "street", interactive = true, initial, label, className, children, onReady }: BaseMapProps) {
  const el = useRef<HTMLDivElement>(null);
  const [ctx, setCtx] = useState<MapCtx>({ map: null, ml: null, styleVersion: 0 });
  const [failed, setFailed] = useState(false);
  const { resolved } = useTheme();
  const url = styleUrl(styleId, resolved === "dark");
  const urlRef = useRef(url);
  const initialRef = useRef(initial);
  const readyRef = useRef(onReady);
  useEffect(() => {
    readyRef.current = onReady;
  });

  useEffect(() => {
    let map: MlMap | null = null;
    let dead = false;
    void import("./maplibre")
      .then(({ default: ml }) => {
        if (dead || !el.current) return;
        const init = initialRef.current;
        map = new ml.Map({
          container: el.current,
          style: urlRef.current,
          interactive,
          attributionControl: { compact: true },
          ...("center" in init ? { center: init.center, zoom: init.zoom } : { bounds: init.bounds, fitBoundsOptions: { padding: init.padding ?? 32 } }),
          dragRotate: interactive,
          pitchWithRotate: false,
          touchPitch: false,
          maxPitch: 0,
          cooperativeGestures: false,
        });
        const m = map;
        if (interactive) m.touchZoomRotate.enableRotation();
        m.on("style.load", () => {
          if (!m.hasImage(HATCH_IMAGE)) m.addImage(HATCH_IMAGE, makeHatchImage(), { pixelRatio: 2 });
          setCtx((c) => ({ map: m, ml, styleVersion: c.styleVersion + 1 }));
        });
        // Styles reference sprites we may not have; keep the console clean.
        m.on("styleimagemissing", (e) => {
          if (!m.hasImage(e.id)) m.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) });
        });
        m.once("load", () => {
          // The container may have settled its size after creation; refit so the area is fully in view.
          if ("bounds" in init) {
            m.resize();
            m.fitBounds(init.bounds, { padding: init.padding ?? 32, duration: 0 });
          }
          readyRef.current?.(m, ml);
        });
      })
      .catch(() => !dead && setFailed(true));
    return () => {
      dead = true;
      map?.remove();
    };
  }, [interactive]);

  // Style switch (and light/dark street): overlays come back on `style.load`.
  useEffect(() => {
    if (urlRef.current === url) return;
    urlRef.current = url;
    ctx.map?.setStyle(url);
  }, [url, ctx.map]);

  return (
    <div className={cn("relative isolate overflow-hidden bg-muted", className)}>
      {/* MapLibre sets position: relative on its container, so size it explicitly. */}
      <div ref={el} role="region" aria-label={label} className="absolute! inset-0 h-full w-full" />
      {failed && <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-muted-foreground">{t("map.failed")}</p>}
      <Ctx.Provider value={ctx}>{children}</Ctx.Provider>
    </div>
  );
}

/** A GeoJSON source with its layers; data updates in place and survives style switches. */
export function useGeoJson(id: string, data: FeatureCollection, layers: ReadonlyArray<{ id: string; type: "fill" | "line" | "circle" | "symbol" } & Record<string, unknown>>) {
  const { map, styleVersion } = useMapCtx();
  const layersRef = useRef(layers);
  useEffect(() => {
    if (!map || !styleVersion) return;
    const src = map.getSource(id) as GeoJSONSource | undefined;
    if (src) {
      src.setData(data);
      return;
    }
    map.addSource(id, { type: "geojson", data });
    for (const l of layersRef.current) map.addLayer({ ...l, source: id } as LayerSpecification);
  }, [map, styleVersion, id, data]);
  useEffect(
    () => () => {
      if (!map || !map.style) return;
      for (const l of layersRef.current) if (map.getLayer(l.id)) map.removeLayer(l.id);
      if (map.getSource(id)) map.removeSource(id);
    },
    [map, id],
  );
}

/** A DOM marker; children render into it (DOM markers are style-independent). */
export function MapMarker({ at, children, anchor = "center", className, zIndex }: { at: LngLat; children: ReactNode; anchor?: "center" | "bottom"; className?: string; zIndex?: number }) {
  const { map, ml } = useMapCtx();
  const [node] = useState(() => (typeof document === "undefined" ? null : document.createElement("div")));
  const marker = useRef<Marker | null>(null);
  useEffect(() => {
    if (!map || !ml || !node) return;
    const m = new ml.Marker({ element: node, anchor });
    marker.current = m;
    // MapLibre owns the marker element's classes; children opt back in with pointer-events-auto.
    const root = m.getElement();
    root.style.pointerEvents = "none";
    if (zIndex !== undefined) root.style.zIndex = String(zIndex);
    m.setLngLat(at).addTo(map);
    return () => {
      m.remove();
      marker.current = null;
    };
    // `at` is applied by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, ml, node, anchor, zIndex]);
  useEffect(() => {
    marker.current?.setLngLat(at);
  }, [at]);
  return node ? createPortal(<div className={className}>{children}</div>, node) : null;
}
