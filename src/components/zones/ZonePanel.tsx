"use client";

import { Copy, Trash2 } from "lucide-react";
import { buildShrinkBehavior, getBuiltInPreset, ROLES, ZONE_TYPES, type Issue, type Settings, type Zone, type ZoneBehavior } from "@/shared";
import { ZONE_LOOK } from "@/components/map/zoneStyle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { formatDuration, t, tm } from "@/i18n";
import { formatClock } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { nextStage, withBehaviorKind } from "./zoneEdit";

const choice =
  "flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm font-medium has-checked:border-primary has-checked:bg-primary/10 has-focus-visible:ring-3 has-focus-visible:ring-ring/50";

function NumberField({ id, label, value, unit, min = 0, max, onChange }: { id: string; label: string; value: number; unit: string; min?: number; max?: number; onChange: (v: number) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={Number.isFinite(value) ? value : ""}
          onChange={(e) => {
            const n = Math.round(Number(e.target.value));
            if (Number.isFinite(n)) onChange(Math.max(min, max !== undefined ? Math.min(max, n) : n));
          }}
          className="font-mono tabular"
        />
        <span className="w-6 shrink-0 text-sm text-muted-foreground">{unit}</span>
      </div>
    </div>
  );
}

interface ZonePanelProps {
  zone: Zone;
  issues: readonly Issue[];
  settings: Settings;
  presetId?: string;
  vertexIndex: number | null;
  onPatch: (patch: Partial<Zone>) => void;
  onRemoveVertex: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onPlaceStage: (i: number) => void;
  placingStage: number | null;
  scrubMs: number | null;
  onScrub: (ms: number | null) => void;
  totalMs: number;
  stageLabel: string;
}

/** Properties of the selected zone, plus the dynamic-zone editor for the play area. */
export function ZonePanel(p: ZonePanelProps) {
  const { zone: z, onPatch } = p;
  const idBase = `zone-${z.id}`;
  const tpl = p.presetId ? getBuiltInPreset(p.presetId)?.mainShrink : undefined;
  const b = z.behavior;
  const stages = b.kind === "shrinking" ? b.phases.map((s) => ({ hold: s.holdSec, trans: s.shrinkSec, center: s.center, radiusM: s.radiusM })) : b.kind === "moving" ? b.waypoints.map((w) => ({ hold: w.holdSec, trans: w.moveSec, center: w.center, radiusM: w.radiusM })) : [];

  const setStages = (next: typeof stages) => {
    if (b.kind === "shrinking") onPatch({ behavior: { ...b, phases: next.map((s) => ({ holdSec: s.hold, shrinkSec: s.trans, center: s.center, radiusM: s.radiusM })) } });
    else if (b.kind === "moving") onPatch({ behavior: { ...b, waypoints: next.map((s) => ({ holdSec: s.hold, moveSec: s.trans, center: s.center, radiusM: s.radiusM })) } });
  };
  const setTiming = (patch: { startDelaySec?: number; warningSec?: number }) => b.kind !== "static" && onPatch({ behavior: { ...b, ...patch } as ZoneBehavior });

  function changeType(type: Zone["type"]) {
    const old = ZONE_LOOK[z.type];
    const patch: Partial<Zone> = { type };
    if (z.color === old.color) patch.color = ZONE_LOOK[type].color;
    if (z.opacity === old.opacity) patch.opacity = ZONE_LOOK[type].opacity;
    if (z.name === t(`zoneTypes.${z.type}`)) patch.name = t(`zoneTypes.${type}`);
    if (type !== "main") patch.behavior = { kind: "static" };
    onPatch(patch);
  }

  return (
    <div className="flex flex-col gap-5">
      {p.issues.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm" aria-label={t("editor.issuesFor")}>
          {p.issues.map((i, n) => (
            <li key={n} className={i.severity === "error" ? "font-medium text-danger" : "text-warning"}>
              {tm(i)}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-col gap-1">
        <label htmlFor={`${idBase}-name`} className="text-sm font-medium">
          {t("editor.name")}
        </label>
        <Input id={`${idBase}-name`} maxLength={40} value={z.name} onChange={(e) => onPatch({ name: e.target.value })} onBlur={() => !z.name.trim() && onPatch({ name: t(`zoneTypes.${z.type}`) })} />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">{t("editor.type")}</legend>
        <div className="grid grid-cols-2 gap-2">
          {ZONE_TYPES.map((type) => {
            const Icon = ZONE_LOOK[type].icon;
            return (
              <label key={type} className={choice}>
                <input type="radio" className="sr-only" name={`${idBase}-type`} checked={z.type === type} onChange={() => changeType(type)} />
                <Icon aria-hidden className="size-4 shrink-0" style={{ color: ZONE_LOOK[type].color }} />
                <span className="truncate">{t(`zoneTypes.${type}`)}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {z.shape.kind === "circle" ? (
        <NumberField id={`${idBase}-radius`} label={t("editor.radius")} value={Math.round(z.shape.radiusM)} unit="m" min={1} max={20_000} onChange={(radiusM) => z.shape.kind === "circle" && onPatch({ shape: { ...z.shape, radiusM } })} />
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">{t("editor.points", { count: z.shape.ring.length })}</span>
          <Button variant="outline" size="sm" disabled={p.vertexIndex === null || z.shape.ring.length <= 3} onClick={p.onRemoveVertex}>
            {t("editor.removePoint")}
          </Button>
          <p className="w-full text-xs text-muted-foreground">{t("editor.vertexHelp")}</p>
        </div>
      )}

      <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-3">
        <label htmlFor={`${idBase}-color`} className="text-sm font-medium">
          {t("editor.color")}
        </label>
        <input id={`${idBase}-color`} type="color" value={z.color} onChange={(e) => onPatch({ color: e.target.value })} className="h-11 w-20 cursor-pointer rounded-xl border bg-transparent p-1" />
        <label htmlFor={`${idBase}-opacity`} className="text-sm font-medium">
          {t("editor.opacity")}
        </label>
        <div className="flex items-center gap-3">
          <input id={`${idBase}-opacity`} type="range" min={0} max={0.6} step={0.02} value={z.opacity} onChange={(e) => onPatch({ opacity: Number(e.target.value) })} className="h-11 flex-1 accent-primary" />
          <span className="w-10 text-end font-mono text-sm tabular">{Math.round(z.opacity * 100)}%</span>
        </div>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">{t("editor.visibleTo")}</legend>
        <div className="grid grid-cols-2 gap-2">
          {ROLES.map((r) => (
            <label key={r} className={choice}>
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={z.visibleTo.includes(r)}
                onChange={(e) => onPatch({ visibleTo: ROLES.filter((x) => (x === r ? e.target.checked : z.visibleTo.includes(x))) })}
              />
              {t(`editor.roles.${r}`)}
            </label>
          ))}
        </div>
        {z.visibleTo.length === 0 && <p className="text-xs text-muted-foreground">{t("editor.hiddenZone")}</p>}
      </fieldset>

      <label className="flex min-h-11 items-center justify-between gap-3 text-sm font-medium">
        {t("editor.enabled")}
        <Switch checked={z.enabled} onCheckedChange={(v) => onPatch({ enabled: v })} />
      </label>

      {z.type === "main" && (
        <section className="flex flex-col gap-4 rounded-2xl border p-4" aria-labelledby={`${idBase}-dyn`}>
          <h3 id={`${idBase}-dyn`} className="text-sm font-semibold">
            {t("editor.dynamic.title")}
          </h3>
          <div role="radiogroup" aria-labelledby={`${idBase}-dyn`} className="grid grid-cols-3 gap-2">
            {(["static", "shrinking", "moving"] as const).map((k) => (
              <label key={k} className={cn(choice, "justify-center px-2 text-center")}>
                <input type="radio" className="sr-only" name={`${idBase}-kind`} checked={b.kind === k} onChange={() => onPatch({ behavior: withBehaviorKind(z, k) })} />
                {t(`editor.dynamic.${k}`)}
              </label>
            ))}
          </div>
          {b.kind === "static" && tpl && (
            <Button variant="outline" onClick={() => onPatch({ behavior: buildShrinkBehavior(z, tpl) })}>
              {t("editor.dynamic.applyPreset")}
            </Button>
          )}
          {b.kind !== "static" && (
            <>
              <p className="text-xs text-pretty text-muted-foreground">{t(b.kind === "shrinking" ? "editor.dynamic.shrinkHelp" : "editor.dynamic.moveHelp")}</p>
              <div className="grid grid-cols-2 gap-3">
                <NumberField id={`${idBase}-delay`} label={t("editor.dynamic.startDelay")} value={b.startDelaySec} unit="s" max={86_400} onChange={(v) => setTiming({ startDelaySec: v })} />
                <NumberField id={`${idBase}-warn`} label={t("editor.dynamic.warning")} value={b.warningSec} unit="s" max={86_400} onChange={(v) => setTiming({ warningSec: v })} />
              </div>
              <ol className="flex flex-col gap-3">
                {stages.map((s, i) => (
                  <li key={i} className="flex flex-col gap-3 rounded-xl border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold">{t("editor.dynamic.stage", { n: i + 1 })}</span>
                      <Button variant="ghost" size="sm" disabled={stages.length <= 1} onClick={() => setStages(stages.filter((_, j) => j !== i))}>
                        {t("common.delete")}
                      </Button>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <NumberField id={`${idBase}-hold-${i}`} label={t("editor.dynamic.hold")} value={s.hold} unit="s" max={86_400} onChange={(v) => setStages(stages.map((x, j) => (j === i ? { ...x, hold: v } : x)))} />
                      <NumberField id={`${idBase}-trans-${i}`} label={t(b.kind === "shrinking" ? "editor.dynamic.shrinkFor" : "editor.dynamic.moveFor")} value={s.trans} unit="s" max={86_400} onChange={(v) => setStages(stages.map((x, j) => (j === i ? { ...x, trans: v } : x)))} />
                      <NumberField id={`${idBase}-r-${i}`} label={t("editor.dynamic.radius")} value={Math.round(s.radiusM)} unit="m" min={1} max={20_000} onChange={(v) => setStages(stages.map((x, j) => (j === i ? { ...x, radiusM: v } : x)))} />
                    </div>
                    <Button variant={p.placingStage === i ? "default" : "outline"} size="sm" onClick={() => p.onPlaceStage(i)} aria-pressed={p.placingStage === i}>
                      {p.placingStage === i ? t("editor.dynamic.placing") : t("editor.dynamic.place")}
                    </Button>
                  </li>
                ))}
              </ol>
              <Button variant="outline" disabled={stages.length >= 12} onClick={() => setStages([...stages, { hold: 300, trans: 120, ...nextStage(z) }])}>
                {t("editor.dynamic.addStage")}
              </Button>
              <div className="flex flex-col gap-2">
                <label htmlFor={`${idBase}-scrub`} className="flex items-center justify-between text-sm font-medium">
                  {t("editor.dynamic.timeline")}
                  <span className="font-mono text-xs text-muted-foreground tabular">{p.scrubMs === null ? t("editor.dynamic.scrubHint") : `${formatClock(p.scrubMs)} · ${p.stageLabel}`}</span>
                </label>
                <input
                  id={`${idBase}-scrub`}
                  type="range"
                  min={0}
                  max={p.totalMs}
                  step={1000}
                  value={p.scrubMs ?? 0}
                  onChange={(e) => p.onScrub(Number(e.target.value))}
                  onKeyDown={(e) => e.key === "Escape" && p.onScrub(null)}
                  className="h-11 w-full accent-primary"
                  aria-valuetext={p.scrubMs === null ? undefined : `${formatDuration(p.scrubMs / 1000)}, ${p.stageLabel}`}
                />
                {p.scrubMs !== null && (
                  <Button variant="ghost" size="sm" className="self-start" onClick={() => p.onScrub(null)}>
                    {t("editor.dynamic.stopPreview")}
                  </Button>
                )}
                <p className="text-xs text-muted-foreground">{t("editor.dynamic.duration", { durationMin: p.settings.timing.durationMin })}</p>
              </div>
            </>
          )}
        </section>
      )}

      <div className="flex gap-2">
        <Button variant="outline" onClick={p.onDuplicate}>
          <Copy aria-hidden />
          {t("editor.duplicate")}
        </Button>
        <Button variant="outline" className="text-danger" onClick={p.onDelete}>
          <Trash2 aria-hidden />
          {t("common.delete")}
        </Button>
      </div>
    </div>
  );
}
