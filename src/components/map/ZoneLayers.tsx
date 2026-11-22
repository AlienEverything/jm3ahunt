"use client";

import { useMemo } from "react";
import type { ExpressionSpecification } from "maplibre-gl";
import { shapeCenter, type Circle, type Zone } from "@/shared";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { MapMarker, useGeoJson } from "./BaseMap";
import { circleFeature, DASH_ARRAY, fc, HATCH_IMAGE, ZONE_LOOK, zonesToGeoJSON, type Dash } from "./zoneStyle";

const dashFilter = (d: Dash): ExpressionSpecification => ["==", ["get", "dash"], d];

/** Fill, hatch and one line layer per dash style (dash arrays are not data-driven). */
function zoneLayerSpecs(prefix: string) {
  const line = (d: Dash) => ({
    id: `${prefix}-line-${d}`,
    type: "line" as const,
    filter: dashFilter(d),
    layout: { "line-join": "round" as const, "line-cap": d === "dotted" || d === "dashdot" ? ("round" as const) : ("butt" as const) },
    paint: {
      "line-color": ["get", "color"] as ExpressionSpecification,
      "line-width": ["get", "width"] as ExpressionSpecification,
      ...(d === "solid" ? {} : { "line-dasharray": DASH_ARRAY[d] }),
    },
  });
  return [
    { id: `${prefix}-fill`, type: "fill" as const, paint: { "fill-color": ["get", "color"] as ExpressionSpecification, "fill-opacity": ["get", "fill"] as ExpressionSpecification } },
    { id: `${prefix}-hatch`, type: "fill" as const, filter: ["==", ["get", "hatch"], 1] as ExpressionSpecification, paint: { "fill-pattern": HATCH_IMAGE, "fill-opacity": 0.55 } },
    {
      id: `${prefix}-selected`,
      type: "line" as const,
      filter: ["==", ["get", "selected"], 1] as ExpressionSpecification,
      paint: { "line-color": "#ffffff", "line-width": ["+", ["get", "width"], 5] as ExpressionSpecification, "line-opacity": 0.85, "line-blur": 1 },
    },
    line("solid"),
    line("dashed"),
    line("dotted"),
    line("dashdot"),
  ];
}

/** A zone's centred icon + name label (DOM marker: no glyph server needed, works on every style). */
export function ZoneLabel({ zone, onSelect, selected, issue }: { zone: Zone; onSelect?: () => void; selected?: boolean; issue?: boolean }) {
  const Icon = ZONE_LOOK[zone.type].icon;
  const at = useMemo(() => shapeCenter(zone.shape), [zone.shape]);
  const body = (
    <>
      <Icon aria-hidden className="size-3.5 shrink-0" style={{ color: zone.color }} strokeWidth={2.5} />
      <span className="max-w-[9rem] truncate">{zone.name || t(`zoneTypes.${zone.type}`)}</span>
      {issue && <span aria-hidden className="size-2 shrink-0 rounded-full bg-danger" />}
    </>
  );
  const cls = cn(
    "flex h-7 items-center gap-1 rounded-full border bg-background/90 px-2 text-[11px] font-semibold text-foreground shadow-sm backdrop-blur-sm",
    selected && "ring-2 ring-ring",
    issue && "border-danger",
  );
  return (
    <MapMarker at={at} zIndex={1}>
      {onSelect ? (
        <button type="button" onClick={onSelect} className={cn(cls, "pointer-events-auto min-h-7 cursor-pointer")} aria-pressed={selected}>
          {body}
          <span className="sr-only">{t(`zoneTypes.${zone.type}`)}</span>
        </button>
      ) : (
        <span className={cls}>{body}</span>
      )}
    </MapMarker>
  );
}

interface ZoneLayersProps {
  zones: readonly Zone[];
  prefix?: string;
  selectedId?: string | null;
  /** Thin the approved area when a dynamic circle is the real boundary. */
  dimMain?: boolean;
  labels?: boolean;
  onSelect?: (id: string) => void;
  issueIds?: ReadonlySet<string>;
}

export function ZoneLayers({ zones, prefix = "jh-zones", selectedId = null, dimMain, labels = true, onSelect, issueIds }: ZoneLayersProps) {
  const data = useMemo(() => zonesToGeoJSON(zones, { selectedId, dimMain }), [zones, selectedId, dimMain]);
  const specs = useMemo(() => zoneLayerSpecs(prefix), [prefix]);
  useGeoJson(prefix, data, specs);
  if (!labels) return null;
  return (
    <>
      {zones
        // In the editor the selected zone shows handles instead of its label.
        .filter((z) => z.enabled && !(onSelect && z.id === selectedId))
        .map((z) => (
          <ZoneLabel key={z.id} zone={z} selected={z.id === selectedId} onSelect={onSelect ? () => onSelect(z.id) : undefined} issue={issueIds?.has(z.id)} />
        ))}
    </>
  );
}

const DYN_SPECS = [
  {
    id: "jh-dyn-next",
    type: "line" as const,
    filter: ["==", ["get", "kind"], "next"] as ExpressionSpecification,
    paint: { "line-color": "#ffffff", "line-width": 2.5, "line-dasharray": [2, 2] },
  },
  {
    id: "jh-dyn-cur-casing",
    type: "line" as const,
    filter: ["==", ["get", "kind"], "current"] as ExpressionSpecification,
    paint: { "line-color": "#111827", "line-width": 6, "line-opacity": 0.35 },
  },
  {
    id: "jh-dyn-cur",
    type: "line" as const,
    filter: ["==", ["get", "kind"], "current"] as ExpressionSpecification,
    paint: { "line-color": ["get", "color"] as ExpressionSpecification, "line-width": 3.5 },
  },
];

/** Dynamic main zone: current circle (solid) and the next one (dashed) while a change is pending. */
export function DynamicZoneLayer({ circle, next, color }: { circle: Circle | null; next: Circle | null; color: string }) {
  const data = useMemo(
    () =>
      fc([
        ...(circle ? [circleFeature(circle.center, circle.radiusM, { kind: "current", color })] : []),
        ...(next ? [circleFeature(next.center, next.radiusM, { kind: "next", color })] : []),
      ]),
    [circle, next, color],
  );
  useGeoJson("jh-dyn", data, DYN_SPECS);
  return null;
}
