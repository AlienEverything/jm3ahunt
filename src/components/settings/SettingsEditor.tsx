"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { getAt, groupLabelKey, SETTINGS_GROUPS, setAt, visibleFields, type Issue, type SettingField, type Settings, type SettingsGroup } from "@/shared";
import { t, tm } from "@/i18n";
import { cn } from "@/lib/utils";
import { formatSettingValue, SettingControl } from "./SettingControl";

interface SettingsEditorProps {
  settings: Settings;
  onChange: (s: Settings) => void;
  issues: readonly Issue[];
  /** Hide dev-only fields (simulation) when the server does not allow them. */
  allowSimulation?: boolean;
}

const fieldId = (path: string) => `setting-${path.replace(/\./g, "-")}`;

function FieldRow({ field, settings, onChange, issues }: { field: SettingField; settings: Settings; onChange: (s: Settings) => void; issues: readonly Issue[] }) {
  const id = fieldId(field.path);
  const value = getAt(settings, field.path);
  const mine = issues.filter((i) => i.path === field.path);
  const isRecommended = JSON.stringify(value) === JSON.stringify(field.recommended);
  const set = (v: unknown) => onChange(setAt(settings, field.path, v));
  const inline = field.control === "toggle";
  // Radio/checkbox sets are labelled by aria-labelledby, not a <label for>.
  const group = field.control === "segmented" || field.control === "select" || field.control === "multiselect";

  return (
    <div className="flex flex-col gap-2 py-4">
      <div className={cn("flex gap-4", inline ? "items-start justify-between" : "flex-col gap-1")}>
        <div className="flex min-w-0 flex-col gap-1">
          {group ? (
            <span id={`${id}-label`} className="font-medium">
              {tm({ key: field.labelKey })}
            </span>
          ) : (
            <label id={`${id}-label`} htmlFor={id} className="font-medium">
              {tm({ key: field.labelKey })}
            </label>
          )}
          <p id={`${id}-help`} className="text-sm text-pretty text-muted-foreground">
            {tm({ key: field.helpKey })}
          </p>
        </div>
        {inline && (
          <div className="pt-1">
            <SettingControl id={id} field={field} value={value} onChange={set} describedBy={`${id}-help`} labelledBy={`${id}-label`} />
          </div>
        )}
      </div>
      {!inline && <SettingControl id={id} field={field} value={value} onChange={set} describedBy={`${id}-help`} labelledBy={`${id}-label`} />}
      <div className="text-xs text-muted-foreground">
        {isRecommended ? (
          <span>{t("settings.recommended", { value: formatSettingValue(field, field.recommended) })}</span>
        ) : (
          <button type="button" onClick={() => set(field.recommended)} className="-my-2 inline-flex min-h-9 items-center underline decoration-dotted underline-offset-4 hover:text-foreground">
            {t("settings.useRecommended", { value: formatSettingValue(field, field.recommended) })}
          </button>
        )}
      </div>
      {mine.length > 0 && (
        <ul className="flex flex-col gap-1" aria-live="polite">
          {mine.map((i, n) => (
            <li key={n} className={cn("text-sm", i.severity === "error" ? "font-medium text-danger" : "text-warning")}>
              {tm(i)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function GroupCard({ group, settings, onChange, issues, allowSimulation }: { group: SettingsGroup } & SettingsEditorProps) {
  const filter = (f: SettingField) => allowSimulation || f.path !== "simulation";
  const basic = visibleFields(settings, group, false).filter(filter);
  const advanced = visibleFields(settings, group, true).filter((f) => f.advanced && filter(f));
  const advancedIssue = advanced.some((f) => issues.some((i) => i.path === f.path && i.severity === "error"));
  const [open, setOpen] = useState(false);
  if (basic.length === 0 && advanced.length === 0) return null;
  const showAdvanced = open || advancedIssue;
  const errors = [...basic, ...advanced].filter((f) => issues.some((i) => i.path === f.path && i.severity === "error")).length;

  return (
    <section aria-labelledby={`group-${group}`} className="rounded-2xl border bg-card px-4">
      <h3 id={`group-${group}`} className="flex items-center gap-2 pt-4 text-base font-semibold">
        {tm({ key: groupLabelKey(group) })}
        {errors > 0 && <span className="rounded-full bg-danger/12 px-2 py-0.5 text-xs font-semibold text-danger">{t("settings.errorCount", { count: errors })}</span>}
      </h3>
      <div className="divide-y">
        {basic.map((f) => (
          <FieldRow key={f.path} field={f} settings={settings} onChange={onChange} issues={issues} />
        ))}
      </div>
      {advanced.length > 0 && (
        <div className="border-t">
          <button
            type="button"
            aria-expanded={showAdvanced}
            aria-controls={`adv-${group}`}
            onClick={() => setOpen(!showAdvanced)}
            className="flex min-h-12 w-full items-center justify-between gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            {t("settings.advancedCount", { count: advanced.length })}
            <ChevronDown aria-hidden className={cn("size-4 transition-transform duration-200 ease-out", showAdvanced && "rotate-180")} />
          </button>
          {showAdvanced && (
            <div id={`adv-${group}`} className="divide-y border-t">
              {advanced.map((f) => (
                <FieldRow key={f.path} field={f} settings={settings} onChange={onChange} issues={issues} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** Generic host settings UI driven by SETTINGS_FIELDS (SPEC §9). */
export function SettingsEditor(props: SettingsEditorProps) {
  return (
    <div className="flex flex-col gap-4">
      {SETTINGS_GROUPS.filter((g) => g !== "zones").map((g) => (
        <GroupCard key={g} group={g} {...props} />
      ))}
    </div>
  );
}
