"use client";

import { useEffect, useMemo, useState } from "react";
import type { MapMouseEvent } from "maplibre-gl";
import { elapsedActiveMs, findMainZone, shapeCenter, zoneStateAt, type LngLat, type MatchView, type ViewLocation, type ViewPlayer } from "@/shared";
import { UserAvatar } from "@/components/common/UserAvatar";
import { BaseMap, MapMarker, readStylePref, saveStylePref, useGeoJson, useMapCtx, type MapStyleId } from "@/components/map/BaseMap";
import { MapControls, type LayerKey } from "@/components/map/MapControls";
import { DynamicZoneLayer, ZoneLayers } from "@/components/map/ZoneLayers";
import { circleFeature, fc, zonesBounds } from "@/components/map/zoneStyle";
import { t } from "@/i18n";
import type { GpsFix } from "@/lib/gps";
import { cn } from "@/lib/utils";

/** "just now" / "40 s ago" / "2 min ago". */
export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 10) return t("live.ago.now");
  if (s < 60) return t("live.ago.sec", { n: s });
  return t("live.ago.min", { n: Math.floor(s / 60) });
}

type Drawable = Exclude<ViewLocation, { precision: "none" }>;

const ACC_SPECS = [
  { id: "jh-acc-fill", type: "fill" as const, filter: ["==", ["get", "kind"], "acc"], paint: { "fill-color": "#3B82F6", "fill-opacity": 0.14 } },
  { id: "jh-acc-line", type: "line" as const, filter: ["==", ["get", "kind"], "acc"], paint: { "line-color": "#3B82F6", "line-width": 1, "line-opacity": 0.6 } },
  // Approximate pings: translucent fill + dashed outline, never confused with an accuracy circle.
  { id: "jh-approx-fill", type: "fill" as const, filter: ["==", ["get", "kind"], "approx"], paint: { "fill-color": ["get", "color"], "fill-opacity": 0.1 } },
  { id: "jh-approx-line", type: "line" as const, filter: ["==", ["get", "kind"], "approx"], paint: { "line-color": ["get", "color"], "line-width": 2, "line-dasharray": [1.5, 1.5] } },
];

const roleColor = (p?: ViewPlayer) => (p?.role === "seeker" ? "#FF5A1F" : "#0EA5A4");

function Circles({ own, approx, players }: { own: GpsFix | null; approx: Extract<Drawable, { precision: "approx" }>[]; players: Map<string, ViewPlayer> }) {
  const data = useMemo(
    () =>
      fc([
        ...(own && own.acc > 0 ? [circleFeature([own.lng, own.lat], Math.min(own.acc, 5000), { kind: "acc" })] : []),
        ...approx.map((a) => circleFeature([a.lng, a.lat], a.radiusM, { kind: "approx", color: roleColor(players.get(a.userId)) })),
      ]),
    [own, approx, players],
  );
  useGeoJson("jh-loc", data, ACC_SPECS);
  return null;
}

/** Follow mode and user-pan detection. */
function FollowController({ me, follow, onFollow }: { me: LngLat | null; follow: boolean; onFollow: (on: boolean) => void }) {
  const { map } = useMapCtx();
  useEffect(() => {
    if (!map) return;
    const off = (e: { originalEvent?: unknown }) => e.originalEvent && onFollow(false);
    map.on("dragstart", off);
    return () => {
      map.off("dragstart", off);
    };
  }, [map, onFollow]);
  useEffect(() => {
    if (map && follow && me) map.easeTo({ center: me, duration: 600 });
  }, [map, follow, me]);
  return null;
}

function TapHandler({ onTap }: { onTap?: (p: LngLat) => void }) {
  const { map } = useMapCtx();
  useEffect(() => {
    if (!map || !onTap) return;
    const h = (e: MapMouseEvent) => onTap([e.lngLat.lng, e.lngLat.lat]);
    map.on("click", h);
    return () => {
      map.off("click", h);
    };
  }, [map, onTap]);
  return null;
}

interface LiveMapProps {
  view: MatchView;
  now: number;
  fix: GpsFix | null;
  /** Simulation: taps move me. */
  onSimTap?: (p: LngLat) => void;
  className?: string;
  controlsClassName?: string;
}

export function LiveMap({ view, now, fix, onSimTap, className, controlsClassName }: LiveMapProps) {
  const [styleId, setStyleId] = useState<MapStyleId>(readStylePref);
  const [follow, setFollow] = useState(false);
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({ zones: true, players: true, pings: true });
  const meId = view.me?.userId;
  const players = useMemo(() => new Map(view.players.map((p) => [p.userId, p])), [view.players]);

  const main = findMainZone(view.zones);
  const dyn = main && main.behavior.kind !== "static" ? zoneStateAt(main, elapsedActiveMs(view.clock, now)) : null;
  const ownServer = view.locations.find((l) => l.userId === meId && l.kind === "live");
  const own = useMemo<GpsFix | null>(() => fix ?? (ownServer && ownServer.precision === "exact" ? { lat: ownServer.lat, lng: ownServer.lng, acc: ownServer.acc, ts: ownServer.at } : null), [fix, ownServer]);
  const ownAt = useMemo<LngLat | null>(() => (own ? [own.lng, own.lat] : null), [own]);

  const others = view.locations.filter((l): l is Drawable => l.userId !== meId && l.precision !== "none");
  const live = others.filter((l) => l.kind === "live");
  const pingsExact = others.filter((l): l is Extract<Drawable, { kind: "ping"; precision: "exact" }> => l.kind === "ping" && l.precision === "exact");
  const pingsApprox = useMemo(() => view.locations.filter((l): l is Extract<Drawable, { precision: "approx" }> => l.userId !== meId && l.precision === "approx"), [view.locations, meId]);
  const shownApprox = layers.pings ? pingsApprox : [];

  const initial = useMemo(() => {
    const b = zonesBounds(view.zones);
    return b ? { bounds: b, padding: 48 } : { center: (main ? shapeCenter(main.shape) : [0, 20]) as LngLat, zoom: main ? 15 : 1.5 };
    // Only the first view matters; later zone changes do not move the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <BaseMap styleId={styleId} initial={initial} label={t("live.mapLabel")} className={className}>
      {layers.zones && <ZoneLayers zones={view.zones} dimMain={!!dyn} />}
      {layers.zones && dyn && main && <DynamicZoneLayer circle={dyn.circle} next={dyn.phase === "final" ? null : dyn.nextCircle} color={main.color} />}
      <Circles own={own} approx={shownApprox} players={players} />
      {shownApprox.map((a) => (
        <MapMarker key={`ax-${a.userId}`} at={[a.lng, a.lat]}>
          <span className="flex flex-col items-center rounded-lg border border-dashed bg-background/85 px-2 py-0.5 text-center text-[11px] leading-tight font-medium shadow-sm backdrop-blur-sm">
            <span className="font-semibold">{t("live.approxArea")}</span>
            <span className="max-w-[8rem] truncate">
              {players.get(a.userId)?.name ?? ""} · {ago(now - a.at)}
            </span>
          </span>
        </MapMarker>
      ))}
      {layers.players &&
        live.map((l) => {
          const p = players.get(l.userId);
          return (
            <MapMarker key={`lv-${l.userId}`} at={[l.lng, l.lat]} zIndex={2}>
              <span className="flex flex-col items-center gap-0.5">
                <UserAvatar avatar={p?.avatar} name={p?.name ?? "?"} size="sm" className={cn("bg-background ring-2", p?.role === "seeker" ? "ring-seeker" : "ring-hider")} />
                <span className="max-w-[6rem] truncate rounded bg-background/85 px-1 text-[10px] font-semibold">{p?.name}</span>
              </span>
            </MapMarker>
          );
        })}
      {layers.pings &&
        pingsExact.map((l) => {
          const p = players.get(l.userId);
          return (
            <MapMarker key={`pg-${l.userId}`} at={[l.lng, l.lat]} anchor="bottom" zIndex={2}>
              <span className="flex flex-col items-center">
                <span className="flex items-center gap-1 rounded-full border bg-background/90 py-0.5 ps-0.5 pe-2 text-[11px] font-semibold shadow-sm">
                  <UserAvatar avatar={p?.avatar} name={p?.name ?? "?"} size="sm" className="size-6 text-sm" />
                  {ago(now - l.at)}
                </span>
                <span aria-hidden className="h-2 w-0.5 bg-foreground/60" />
                <span aria-hidden className="size-2 rounded-full border-2 border-background bg-foreground" />
              </span>
            </MapMarker>
          );
        })}
      {ownAt && (
        <MapMarker at={ownAt} zIndex={3}>
          <span className="relative flex size-5 items-center justify-center" role="img" aria-label={t("live.you")}>
            <span aria-hidden className="absolute inset-0 rounded-full bg-[#3B82F6]/25" />
            <span aria-hidden className="size-4 rounded-full border-[3px] border-white bg-[#3B82F6] shadow" />
          </span>
        </MapMarker>
      )}
      <FollowController me={ownAt} follow={follow} onFollow={setFollow} />
      <TapHandler onTap={onSimTap} />
      <MapControls
        className={cn("absolute end-3 bottom-8", controlsClassName)}
        styleId={styleId}
        onStyle={(id) => {
          setStyleId(id);
          saveStylePref(id);
        }}
        me={ownAt}
        follow={follow}
        onFollow={setFollow}
        layers={layers}
        onLayer={(k, v) => setLayers((s) => ({ ...s, [k]: v }))}
      />
    </BaseMap>
  );
}
