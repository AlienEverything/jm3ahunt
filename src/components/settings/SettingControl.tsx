"use client";

import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import type { SettingField } from "@/shared";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { formatDuration, t, tm, type MessageKey } from "@/i18n";
import { cn } from "@/lib/utils";

const UNIT_KEY: Record<NonNullable<SettingField["unit"]>, MessageKey> = {
  sec: "units.short.sec",
  min: "units.short.min",
  m: "units.short.m",
  mps: "units.short.mps",
  points: "units.short.points",
  players: "units.short.players",
};

/** Human value for summaries and the "Recommended" hint. */
export function formatSettingValue(f: SettingField, v: unknown): string {
  if (f.control === "toggle") return v ? t("common.on") : t("common.off");
  if (f.options) {
    const label = (val: unknown) => {
      const o = f.options!.find((x) => x.value === val);
      return o ? tm({ key: o.labelKey }) : String(val);
    };
    return Array.isArray(v) ? (v.length ? v.map(label).join(", ") : t("common.none")) : label(v);
  }
  if (typeof v === "number") {
    if (f.control === "duration") return v === 0 ? t("common.off") : formatDuration(f.unit === "min" ? v * 60 : v);
    return f.unit ? `${v} ${t(UNIT_KEY[f.unit])}` : String(v);
  }
  return String(v);
}

const clamp = (n: number, f: SettingField) => Math.min(f.max ?? Infinity, Math.max(f.min ?? -Infinity, n));

function Stepper({ id, field, value, onChange, describedBy }: { id: string; field: SettingField; value: number; onChange: (v: number) => void; describedBy?: string }) {
  const step = field.step ?? 1;
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (raw: string) => {
    setDraft(null);
    const n = Number(raw);
    if (raw.trim() !== "" && Number.isFinite(n)) onChange(clamp(Math.round(n), field));
  };
  const unit = field.unit ? t(UNIT_KEY[field.unit]) : null;
  return (
    <div className="flex items-center gap-2">
      <Button type="button" variant="outline" size="icon" aria-label={t("settings.decrease")} disabled={value <= (field.min ?? -Infinity)} onClick={() => onChange(clamp(value - step, field))}>
        <Minus aria-hidden />
      </Button>
      <div className="relative w-28">
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={field.min}
          max={field.max}
          step={1}
          value={draft ?? String(value)}
          aria-describedby={describedBy}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && commit(e.currentTarget.value)}
          className={cn(
            "h-11 w-full rounded-xl border border-input bg-card text-center font-mono tabular outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30",
            unit && "pe-10",
            "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
          )}
        />
        {unit && <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-sm text-muted-foreground">{unit}</span>}
      </div>
      <Button type="button" variant="outline" size="icon" aria-label={t("settings.increase")} disabled={value >= (field.max ?? Infinity)} onClick={() => onChange(clamp(value + step, field))}>
        <Plus aria-hidden />
      </Button>
      {field.control === "duration" && field.unit === "sec" && value >= 60 && <span className="text-sm text-muted-foreground tabular">= {formatDuration(value)}</span>}
    </div>
  );
}

const choiceClass =
  "flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm font-medium transition-[background-color,border-color,color] duration-150 select-none has-checked:border-primary has-checked:bg-primary/10 has-focus-visible:ring-3 has-focus-visible:ring-ring/50 hover:bg-muted";

/** One control for a registry field. Value shape follows the field's control type. */
export function SettingControl({ id, field, value, onChange, describedBy, labelledBy }: { id: string; field: SettingField; value: unknown; onChange: (v: unknown) => void; describedBy?: string; labelledBy?: string }) {
  switch (field.control) {
    case "toggle":
      return <Switch id={id} checked={Boolean(value)} onCheckedChange={(c) => onChange(c)} aria-describedby={describedBy} aria-labelledby={labelledBy} />;
    case "number":
    case "duration":
      return <Stepper id={id} field={field} value={Number(value)} onChange={onChange} describedBy={describedBy} />;
    case "slider":
      return (
        <div className="flex items-center gap-3">
          <input
            id={id}
            type="range"
            min={field.min}
            max={field.max}
            step={field.step}
            value={Number(value)}
            aria-describedby={describedBy}
            onChange={(e) => onChange(Number(e.target.value))}
            className="h-11 flex-1 accent-primary"
          />
          <span className="w-20 text-end font-mono text-sm tabular">{formatSettingValue(field, value)}</span>
        </div>
      );
    case "segmented":
    case "select":
      return (
        <div role="radiogroup" aria-labelledby={labelledBy} aria-describedby={describedBy} className={cn("grid gap-2", field.control === "segmented" ? "grid-cols-2" : "grid-cols-1 sm:grid-cols-2")}>
          {field.options!.map((o) => (
            <label key={o.value} className={cn(choiceClass, field.control === "segmented" && "justify-center text-center")}>
              <input type="radio" className="sr-only" name={id} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
              {tm({ key: o.labelKey })}
            </label>
          ))}
        </div>
      );
    case "multiselect": {
      const list = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div role="group" aria-labelledby={labelledBy} aria-describedby={describedBy} className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {field.options!.map((o) => (
            <label key={o.value} className={choiceClass}>
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={list.includes(o.value)}
                onChange={(e) => {
                  // Keep registry order so equal choices give equal settings hashes.
                  const next = e.target.checked ? [...list, o.value] : list.filter((x) => x !== o.value);
                  onChange(field.options!.map((x) => x.value).filter((v) => next.includes(v)));
                }}
              />
              {tm({ key: o.labelKey })}
            </label>
          ))}
        </div>
      );
    }
  }
}
