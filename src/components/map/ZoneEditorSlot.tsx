"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Circle as CircleIcon, CircleHelp, Eye, FolderOpen, Hexagon, LocateFixed, MousePointer2, Redo2, Square, Undo2 } from "lucide-react";
import type { MapMouseEvent } from "maplibre-gl";
import { toast } from "sonner";
import {
  destination,
  distanceM,
  findMainZone,
  openRing,
  shapeCenter,
  timelineTotalMs,
  zoneStateAt,
  type Issue,
  type LngLat,
  type PresetDto,
  type Role,
  type Settings,
  type Zone,
} from "@/shared";
import { Sheet } from "@/components/common/Sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { t, tm } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ZonePanel } from "@/components/zones/ZonePanel";
import { insertVertex, makeZone, midpoints, moveBehavior, moveShape, radiusFrom, radiusHandle, rectangleAt, removeVertex, replaceVertex } from "@/components/zones/zoneEdit";
import { BaseMap, readStylePref, saveStylePref, useGeoJson, useMapCtx, type MapStyleId } from "./BaseMap";
import { DragHandle } from "./DragHandle";
import { MapControls } from "./MapControls";
import { DynamicZoneLayer, ZoneLayers } from "./ZoneLayers";
import { DASH_ARRAY, fc, ZONE_LOOK, zonesBounds } from "./zoneStyle";

export interface ZoneEditorSlotProps {
  zones: Zone[];
  onChange: (zones: Zone[]) => void;
  /** Current rules (timing drives the shrink timeline preview). */
  settings: Settings;
  /** Issues whose path starts with `zones` (from validateSettings with zones). */
  issues: readonly Issue[];
  /** Built-in preset shrink template the editor can offer to apply once a main zone exists. */
  presetId?: string;
  /** Group for zone-layout presets (save / load). */
  groupId?: string;
  presets?: readonly PresetDto[];
}

type Tool = "select" | "circle" | "rect" | "polygon";
const EDIT_PREFIX = "jh-edit";
const ROUND = (n: number) => Math.round(n / 10) * 10;

/** Default new-shape size: a fifth of the visible map width. */
function defaultRadius(map: ReturnType<typeof useMapCtx>["map"]): number {
  if (!map) return 150;
  const b = map.getBounds();
  const w = distanceM([b.getWest(), map.getCenter().lat], [b.getEast(), map.getCenter().lat]);
  return Math.min(5000, Math.max(20, ROUND(w * 0.2)));
}

function MapClicks({ onClick }: { onClick: (p: LngLat, hitId: string | null, radius: number) => void }) {
  const { map } = useMapCtx();
  const cb = useRef(onClick);
  useEffect(() => {
    cb.current = onClick;
  });
  useEffect(() => {
    if (!map) return;
    const h = (e: MapMouseEvent) => {
      // Taps on labels and handles (DOM markers) are theirs, not the map's.
      if ((e.originalEvent.target as Element | null)?.closest?.(".maplibregl-marker")) return;
      const hits = map.getLayer(`${EDIT_PREFIX}-fill`) ? map.queryRenderedFeatures(e.point, { layers: [`${EDIT_PREFIX}-fill`] }) : [];
      const id = hits.length ? String(hits[hits.length - 1].properties?.id ?? "") || null : null;
      cb.current([e.lngLat.lng, e.lngLat.lat], id, defaultRadius(map));
    };
    map.on("click", h);
    return () => {
      map.off("click", h);
    };
  }, [map]);
  return null;
}

type FlyTarget = { bounds: [LngLat, LngLat]; n: number };
function FlyTo({ target }: { target: FlyTarget | null }) {
  const { map } = useMapCtx();
  useEffect(() => {
    if (map && target) map.fitBounds(target.bounds, { padding: 56, maxZoom: 17, duration: 700 });
  }, [map, target]);
  return null;
}

const DRAFT_SPECS = [
  { id: "jh-draft-line", type: "line" as const, paint: { "line-color": "#111827", "line-width": 2, "line-dasharray": DASH_ARRAY.dashed } },
  { id: "jh-draft-pts", type: "circle" as const, paint: { "circle-radius": 5, "circle-color": "#ffffff", "circle-stroke-color": "#111827", "circle-stroke-width": 2 } },
];

function DraftLayer({ points }: { points: LngLat[] }) {
  const data = useMemo(
    () =>
      fc([
        ...(points.length > 1 ? [{ type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: points } }] : []),
        ...points.map((p) => ({ type: "Feature" as const, properties: {}, geometry: { type: "Point" as const, coordinates: p } })),
      ]),
    [points],
  );
  useGeoJson("jh-draft", data, DRAFT_SPECS);
  return null;
}

/** Match setup "Play area" step: draw and edit zones, dynamic play area, layouts. */
export function ZoneEditorSlot({ zones, onChange, settings, issues, presetId, groupId, presets = [] }: ZoneEditorSlotProps) {
  const [tool, setTool] = useState<Tool>("select");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [vertex, setVertex] = useState<number | null>(null);
  const [draft, setDraft] = useState<LngLat[]>([]);
  const [placing, setPlacing] = useState<number | null>(null);
  const [scrub, setScrub] = useState<number | null>(null);
  const [previewRole, setPreviewRole] = useState<Role | null>(null);
  const [styleId, setStyleId] = useState<MapStyleId>(readStylePref);
  const [sheet, setSheet] = useState<null | "help" | "layouts">(null);
  const [layoutName, setLayoutName] = useState("");
  const [savedLayouts, setSavedLayouts] = useState<PresetDto[]>(() => presets.filter((p) => p.kind === "zones"));
  const [locating, setLocating] = useState(false);
  const [fly, setFly] = useState<FlyTarget | null>(null);

  // History: undo/redo stacks of whole layouts.
  const past = useRef<Zone[][]>([]);
  const future = useRef<Zone[][]>([]);
  const [hist, setHist] = useState({ past: 0, future: 0 });
  const bump = () => setHist({ past: past.current.length, future: future.current.length });
  const current = useRef(zones);
  useEffect(() => {
    current.current = zones;
  });
  const commit = useCallback(
    (next: Zone[]) => {
      past.current = [...past.current.slice(-49), current.current];
      future.current = [];
      onChange(next);
      setHist({ past: past.current.length, future: 0 });
    },
    [onChange],
  );
  const dragBase = useRef<Zone[] | null>(null);
  const dragStart = () => (dragBase.current = current.current);
  const dragEnd = () => {
    if (dragBase.current) past.current = [...past.current.slice(-49), dragBase.current];
    future.current = [];
    dragBase.current = null;
    bump();
  };
  const undo = () => {
    const prev = past.current.at(-1);
    if (!prev) return;
    past.current = past.current.slice(0, -1);
    future.current = [...future.current, current.current];
    onChange(prev);
    bump();
  };
  const redo = () => {
    const next = future.current.at(-1);
    if (!next) return;
    future.current = future.current.slice(0, -1);
    past.current = [...past.current, current.current];
    onChange(next);
    bump();
  };

  const selected = zones.find((z) => z.id === selectedId) ?? null;
  const main = findMainZone(zones);
  const patchZone = (id: string, patch: Partial<Zone>, live = false) => {
    const next = current.current.map((z) => (z.id === id ? { ...z, ...patch } : z));
    if (live) onChange(next);
    else commit(next);
  };
  const issueIds = useMemo(() => new Set(issues.filter((i) => i.severity === "error").map((i) => i.path.split(".")[1]).filter(Boolean)), [issues]);
  const zoneIssues = (id: string) => issues.filter((i) => i.path.split(".")[1] === id);
  const generalIssues = issues.filter((i) => !i.path.split(".")[1] || !zones.some((z) => z.id === i.path.split(".")[1]));

  const flyTo = (zs: readonly Zone[]) => {
    const b = zonesBounds(zs);
    if (b) setFly((f) => ({ bounds: b, n: (f?.n ?? 0) + 1 }));
  };
  const add = (z: Zone) => {
    commit([...current.current, z]);
    setSelectedId(z.id);
    setVertex(null);
    setTool("select");
  };
  const newType = () => (findMainZone(current.current) ? "safe" : "main");

  function onMapClick(p: LngLat, hitId: string | null, r: number) {
    if (previewRole) return;
    if (placing !== null && selected?.type === "main") {
      const b = selected.behavior;
      if (b.kind === "shrinking") patchZone(selected.id, { behavior: { ...b, phases: b.phases.map((s, i) => (i === placing ? { ...s, center: p } : s)) } });
      if (b.kind === "moving") patchZone(selected.id, { behavior: { ...b, waypoints: b.waypoints.map((s, i) => (i === placing ? { ...s, center: p } : s)) } });
      setPlacing(null);
      return;
    }
    const type = newType();
    const name = t(`zoneTypes.${type}`);
    if (tool === "circle") add(makeZone(type, { kind: "circle", center: p, radiusM: r }, name));
    else if (tool === "rect") add(makeZone(type, { kind: "polygon", ring: rectangleAt(p, r, ROUND(r * 0.7)) }, name));
    else if (tool === "polygon") setDraft((d) => [...d, p]);
    else {
      setSelectedId(hitId);
      setVertex(null);
    }
  }

  function finishPolygon() {
    if (draft.length < 3) return;
    const type = newType();
    add(makeZone(type, { kind: "polygon", ring: draft }, t(`zoneTypes.${type}`)));
    setDraft([]);
  }

  function aroundMe() {
    if (!("geolocation" in navigator)) return toast.error(t("gps.status.unsupported"));
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const at: LngLat = [pos.coords.longitude, pos.coords.latitude];
        const type = newType();
        const z = makeZone(type, { kind: "circle", center: at, radiusM: 300 }, t(`zoneTypes.${type}`));
        add(z);
        flyTo([z]);
      },
      (err) => {
        setLocating(false);
        toast.error(err.code === err.PERMISSION_DENIED ? t("gps.status.denied") : t("gps.status.unavailable"));
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 30_000 },
    );
  }

  function duplicate(z: Zone) {
    const shift = (p: LngLat) => destination(p, 40, 135);
    const c = shapeCenter(z.shape);
    const copy = { ...makeZone(z.type, moveShape(z.shape, c, shift(c)), `${z.name} 2`.slice(0, 40)), color: z.color, opacity: z.opacity, visibleTo: [...z.visibleTo] };
    add(copy);
  }

  function remove(z: Zone) {
    commit(current.current.filter((x) => x.id !== z.id));
    setSelectedId(null);
    toast(t("editor.deleted", { name: z.name }), { action: { label: t("common.undo"), onClick: undo } });
  }

  async function saveLayout() {
    if (!groupId) return;
    try {
      const p = await api<PresetDto>(`/groups/${groupId}/presets`, { body: { kind: "zones", name: layoutName.trim(), mode: "hide_seek", data: { zones } } });
      setSavedLayouts((l) => [p, ...l]);
      setLayoutName("");
      toast.success(t("editor.layouts.saved"));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  // Timeline preview of the main zone.
  const totalMs = main ? Math.max(timelineTotalMs(main), settings.timing.durationMin * 60_000) : 0;
  const scrubState = main && scrub !== null && main.behavior.kind !== "static" ? zoneStateAt(main, scrub) : null;
  const stageLabel = scrubState
    ? scrubState.phase === "final"
      ? t("editor.dynamic.final")
      : scrubState.phase === "transition"
        ? t("editor.dynamic.inTransition", { n: scrubState.phaseIndex + 1 })
        : t("editor.dynamic.holding", { n: scrubState.phaseIndex + 1 })
    : "";

  const shown = previewRole ? zones.filter((z) => z.visibleTo.includes(previewRole)) : zones;
  const bounds = useMemo(() => zonesBounds(zones), []); // eslint-disable-line react-hooks/exhaustive-deps -- first view only
  const handles = !previewRole && selected && selected.enabled;
  const stages = selected?.type === "main" ? (selected.behavior.kind === "shrinking" ? selected.behavior.phases : selected.behavior.kind === "moving" ? selected.behavior.waypoints : []) : [];

  const tools: { id: Tool; icon: typeof CircleIcon }[] = [
    { id: "select", icon: MousePointer2 },
    { id: "circle", icon: CircleIcon },
    { id: "rect", icon: Square },
    { id: "polygon", icon: Hexagon },
  ];
  const toolBtn = "pointer-events-auto flex size-11 items-center justify-center rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-40";

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <BaseMap styleId={styleId} initial={bounds ? { bounds, padding: 40 } : { center: [10, 30], zoom: 1.5 }} label={t("editor.mapLabel")} className="h-[min(68dvh,560px)] min-h-80 w-full rounded-2xl border">
          <ZoneLayers zones={shown} prefix={EDIT_PREFIX} selectedId={previewRole ? null : selectedId} onSelect={previewRole ? undefined : (id) => (setSelectedId(id), setVertex(null), setTool("select"))} issueIds={issueIds} dimMain={!!scrubState} />
          {scrubState && main && <DynamicZoneLayer circle={scrubState.circle} next={scrubState.nextCircle} color={main.color} />}
          <DraftLayer points={draft} />
          <MapClicks onClick={onMapClick} />
          <FlyTo target={fly} />
          {handles && selected.shape.kind === "circle" && (
            <>
              <DragHandle
                key={`c-${selected.id}`}
                at={selected.shape.center}
                variant="center"
                label={t("editor.handles.move")}
                onDragStart={dragStart}
                onDrag={(p) => {
                  const z = current.current.find((x) => x.id === selected.id);
                  if (z?.shape.kind !== "circle") return;
                  patchZone(z.id, { shape: { ...z.shape, center: p }, behavior: moveBehavior(z.behavior, z.shape.center, p) }, true);
                }}
                onDragEnd={dragEnd}
              />
              <DragHandle
                key={`r-${selected.id}`}
                at={radiusHandle(selected.shape.center, selected.shape.radiusM)}
                variant="radius"
                label={t("editor.handles.radius", { m: Math.round(selected.shape.radiusM) })}
                onDragStart={dragStart}
                onDrag={(p) => {
                  const z = current.current.find((x) => x.id === selected.id);
                  if (z?.shape.kind === "circle") patchZone(z.id, { shape: { ...z.shape, radiusM: radiusFrom(z.shape.center, p) } }, true);
                }}
                onDragEnd={dragEnd}
              />
            </>
          )}
          {handles && selected.shape.kind === "polygon" && (
            <>
              {openRing(selected.shape.ring).map((v, i) => (
                <DragHandle
                  key={`v-${selected.id}-${i}`}
                  at={v}
                  active={vertex === i}
                  label={t("editor.handles.vertex", { n: i + 1 })}
                  onTap={() => setVertex(i)}
                  onDragStart={() => {
                    setVertex(i);
                    dragStart();
                  }}
                  onDrag={(p) => {
                    const z = current.current.find((x) => x.id === selected.id);
                    if (z?.shape.kind === "polygon") patchZone(z.id, { shape: { kind: "polygon", ring: replaceVertex(z.shape.ring, i, p) } }, true);
                  }}
                  onDragEnd={dragEnd}
                />
              ))}
              {midpoints(selected.shape.ring).map((m, i) => (
                <DragHandle
                  key={`m-${selected.id}-${i}-${m[0]}`}
                  at={m}
                  variant="mid"
                  draggable={false}
                  label={t("editor.handles.insert")}
                  onTap={() => {
                    if (selected.shape.kind !== "polygon") return;
                    patchZone(selected.id, { shape: { kind: "polygon", ring: insertVertex(selected.shape.ring, i, m) } });
                    setVertex(i + 1);
                  }}
                />
              ))}
              <DragHandle
                key={`pc-${selected.id}`}
                at={shapeCenter(selected.shape)}
                variant="center"
                label={t("editor.handles.move")}
                onDragStart={dragStart}
                onDrag={(p) => {
                  const z = current.current.find((x) => x.id === selected.id);
                  if (!z) return;
                  const from = shapeCenter(z.shape);
                  patchZone(z.id, { shape: moveShape(z.shape, from, p), behavior: moveBehavior(z.behavior, from, p) }, true);
                }}
                onDragEnd={dragEnd}
              />
            </>
          )}
          {handles &&
            stages.map((s, i) => (
              <DragHandle
                key={`s-${selected.id}-${i}`}
                at={s.center}
                variant="phase"
                text={String(i + 1)}
                label={t("editor.handles.stage", { n: i + 1 })}
                onDragStart={dragStart}
                onDrag={(p) => {
                  const z = current.current.find((x) => x.id === selected.id);
                  const b = z?.behavior;
                  if (!z || !b) return;
                  if (b.kind === "shrinking") patchZone(z.id, { behavior: { ...b, phases: b.phases.map((x, j) => (j === i ? { ...x, center: p } : x)) } }, true);
                  if (b.kind === "moving") patchZone(z.id, { behavior: { ...b, waypoints: b.waypoints.map((x, j) => (j === i ? { ...x, center: p } : x)) } }, true);
                }}
                onDragEnd={dragEnd}
              />
            ))}

          {/* Toolbar (top-start) */}
          <div className="pointer-events-none absolute inset-x-2 top-2 z-10 flex flex-wrap items-start justify-between gap-2">
            <div role="toolbar" aria-label={t("editor.tools.label")} className="pointer-events-auto flex rounded-xl border bg-background/95 p-0.5 shadow-sm backdrop-blur">
              {tools.map(({ id, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={tool === id}
                  aria-label={t(`editor.tools.${id}`)}
                  title={t(`editor.tools.${id}`)}
                  disabled={!!previewRole}
                  onClick={() => {
                    setTool(id);
                    setDraft([]);
                    setPlacing(null);
                  }}
                  className={cn(toolBtn, tool === id && "bg-primary text-primary-foreground")}
                >
                  <Icon aria-hidden className="size-5" />
                </button>
              ))}
              <span aria-hidden className="mx-0.5 my-2 w-px bg-border" />
              <button type="button" className={toolBtn} onClick={undo} disabled={hist.past === 0 || !!previewRole} aria-label={t("common.undo")} title={t("common.undo")}>
                <Undo2 aria-hidden className="size-5" />
              </button>
              <button type="button" className={toolBtn} onClick={redo} disabled={hist.future === 0 || !!previewRole} aria-label={t("editor.redo")} title={t("editor.redo")}>
                <Redo2 aria-hidden className="size-5" />
              </button>
            </div>
            <div className="pointer-events-auto flex gap-1 rounded-xl border bg-background/95 p-0.5 shadow-sm backdrop-blur">
              <button type="button" className={cn(toolBtn, previewRole && "bg-primary text-primary-foreground")} aria-pressed={!!previewRole} aria-label={t("editor.preview.toggle")} title={t("editor.preview.toggle")} onClick={() => setPreviewRole(previewRole ? null : "hider")}>
                <Eye aria-hidden className="size-5" />
              </button>
              <button type="button" className={toolBtn} aria-label={t("editor.help.title")} title={t("editor.help.title")} onClick={() => setSheet("help")}>
                <CircleHelp aria-hidden className="size-5" />
              </button>
              {groupId && (
                <button type="button" className={toolBtn} aria-label={t("editor.layouts.title")} title={t("editor.layouts.title")} onClick={() => setSheet("layouts")}>
                  <FolderOpen aria-hidden className="size-5" />
                </button>
              )}
            </div>
          </div>

          {/* Context strip (bottom-start) */}
          <div className="pointer-events-none absolute start-2 bottom-12 z-10 flex max-w-[calc(100%-4.5rem)] flex-col items-start gap-2">
            {previewRole && (
              <div role="radiogroup" aria-label={t("editor.preview.as")} className="pointer-events-auto flex items-center gap-1 rounded-xl border bg-background/95 p-1 text-sm shadow-sm backdrop-blur">
                <span className="px-2 text-xs text-muted-foreground">{t("editor.preview.as")}</span>
                {(["seeker", "hider"] as const).map((r) => (
                  <button key={r} type="button" role="radio" aria-checked={previewRole === r} onClick={() => setPreviewRole(r)} className={cn("h-9 rounded-lg px-3 font-medium", previewRole === r ? "bg-primary text-primary-foreground" : "")}>
                    {t(`roles.${r}`)}
                  </button>
                ))}
              </div>
            )}
            {!previewRole && tool === "polygon" && (
              <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-xl border bg-background/95 p-2 text-sm shadow-sm backdrop-blur">
                <span className="px-1">{t("editor.polygonHint", { count: draft.length })}</span>
                <Button size="sm" onClick={finishPolygon} disabled={draft.length < 3}>
                  {t("editor.finish")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDraft((d) => d.slice(0, -1))} disabled={draft.length === 0}>
                  {t("common.undo")}
                </Button>
              </div>
            )}
            {!previewRole && (tool === "circle" || tool === "rect") && <p className="rounded-xl border bg-background/95 px-3 py-2 text-sm shadow-sm backdrop-blur">{t("editor.tapToPlace")}</p>}
            {!previewRole && placing !== null && <p className="rounded-xl border border-primary bg-background/95 px-3 py-2 text-sm shadow-sm backdrop-blur">{t("editor.dynamic.placeHint", { n: placing + 1 })}</p>}
            {!previewRole && !main && tool === "select" && (
              <Button className="pointer-events-auto shadow-md" onClick={aroundMe} disabled={locating}>
                <LocateFixed aria-hidden />
                {locating ? t("gps.status.checking") : t("editor.aroundMe")}
              </Button>
            )}
          </div>

          <MapControls
            className="absolute end-2 bottom-8 z-10"
            styleId={styleId}
            onStyle={(id) => {
              setStyleId(id);
              saveStylePref(id);
            }}
          />
        </BaseMap>
      </div>

      {generalIssues.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm" role="status">
          {generalIssues.map((i, n) => (
            <li key={n} className={i.severity === "error" ? "font-medium text-danger" : "text-warning"}>
              {tm(i)}
            </li>
          ))}
        </ul>
      )}

      {zones.length > 0 && (
        <ul className="divide-y overflow-hidden rounded-2xl border bg-card" aria-label={t("editor.list")}>
          {zones.map((z) => {
            const Icon = ZONE_LOOK[z.type].icon;
            const bad = issueIds.has(z.id);
            return (
              <li key={z.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedId(z.id === selectedId ? null : z.id);
                    setVertex(null);
                    setTool("select");
                    if (z.id !== selectedId) flyTo([z]);
                  }}
                  aria-expanded={z.id === selectedId}
                  className={cn("flex min-h-14 w-full items-center gap-3 px-4 py-2 text-start outline-none hover:bg-muted focus-visible:bg-muted", z.id === selectedId && "bg-muted")}
                >
                  <Icon aria-hidden className="size-5 shrink-0" style={{ color: z.color }} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium">{z.name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {t(`zoneTypes.${z.type}`)}
                      {z.shape.kind === "circle" ? ` · ${t("units.meters", { n: Math.round(z.shape.radiusM) })}` : ` · ${t("editor.points", { count: z.shape.ring.length })}`}
                      {!z.enabled ? ` · ${t("editor.disabled")}` : ""}
                      {z.behavior.kind !== "static" ? ` · ${t(`editor.dynamic.${z.behavior.kind}`)}` : ""}
                    </span>
                  </span>
                  {bad && <span className="shrink-0 rounded-full bg-danger/12 px-2 py-0.5 text-xs font-medium text-danger">{t("editor.fix")}</span>}
                </button>
                {z.id === selectedId && (
                  <div className="border-t bg-background px-4 py-4">
                    <ZonePanel
                      zone={z}
                      issues={zoneIssues(z.id)}
                      settings={settings}
                      presetId={presetId}
                      vertexIndex={vertex}
                      onPatch={(patch) => patchZone(z.id, patch)}
                      onRemoveVertex={() => {
                        if (z.shape.kind !== "polygon" || vertex === null) return;
                        patchZone(z.id, { shape: { kind: "polygon", ring: removeVertex(z.shape.ring, vertex) } });
                        setVertex(null);
                      }}
                      onDuplicate={() => duplicate(z)}
                      onDelete={() => remove(z)}
                      placingStage={placing}
                      onPlaceStage={(i) => setPlacing(placing === i ? null : i)}
                      scrubMs={scrub}
                      onScrub={setScrub}
                      totalMs={totalMs}
                      stageLabel={stageLabel}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {zones.length === 0 && <p className="text-sm text-pretty text-muted-foreground">{t("editor.empty")}</p>}

      <Sheet open={sheet === "help"} onOpenChange={(o) => setSheet(o ? "help" : null)} title={t("editor.help.title")}>
        <div className="flex flex-col gap-4 text-sm">
          <p className="text-pretty">{t("editor.help.priority")}</p>
          <ol className="list-decimal ps-5 leading-relaxed">
            <li>{t("zoneTypes.restricted")}</li>
            <li>{t("editor.help.jail")}</li>
            <li>{t("zoneTypes.safe")}</li>
            <li>{t("editor.help.objectives")}</li>
            <li>{t("zoneTypes.main")}</li>
          </ol>
          <p className="text-pretty text-muted-foreground">{t("editor.help.dynamic")}</p>
          <p className="text-pretty text-muted-foreground">{t("editor.help.lines")}</p>
        </div>
      </Sheet>

      <Sheet open={sheet === "layouts"} onOpenChange={(o) => setSheet(o ? "layouts" : null)} title={t("editor.layouts.title")} description={t("editor.layouts.body")}>
        <div className="flex flex-col gap-5">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (layoutName.trim() && zones.length) void saveLayout();
            }}
          >
            <label htmlFor="layout-name" className="sr-only">
              {t("editor.layouts.name")}
            </label>
            <Input id="layout-name" maxLength={40} placeholder={t("editor.layouts.name")} value={layoutName} onChange={(e) => setLayoutName(e.target.value)} />
            <Button type="submit" disabled={!layoutName.trim() || zones.length === 0}>
              {t("common.save")}
            </Button>
          </form>
          {savedLayouts.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("editor.layouts.empty")}</p>
          ) : (
            <ul className="divide-y rounded-2xl border">
              {savedLayouts.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-4 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (!("zones" in p.data)) return;
                      commit(structuredClone(p.data.zones));
                      setSelectedId(null);
                      setSheet(null);
                      flyTo(p.data.zones);
                    }}
                  >
                    {t("editor.layouts.load")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Sheet>
    </div>
  );
}
