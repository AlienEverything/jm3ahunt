"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BookmarkPlus, ListChecks, RotateCcw, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import {
  BUILT_IN_PRESETS,
  DEFAULT_SETTINGS,
  getBuiltInPreset,
  hasErrors,
  validateSettings,
  withDefaults,
  type MatchInfoDto,
  type PresetDto,
  type Settings,
  type Zone,
} from "@/shared";
import { Section } from "@/components/common/States";
import { Sheet } from "@/components/common/Sheet";
import { StickyFooter } from "@/components/layout/TopBar";
import { ZoneEditorSlot } from "@/components/map/ZoneEditorSlot";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { t, tm } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { RulesSummary, shortRules } from "./RulesSummary";
import { SettingsEditor } from "./SettingsEditor";

/** Settings from a built-in or saved preset id, filled with current defaults. */
export function presetSettings(id: string | null, saved: readonly PresetDto[]): Settings | null {
  if (!id) return null;
  const builtIn = getBuiltInPreset(id);
  if (builtIn) return structuredClone(builtIn.settings);
  const p = saved.find((x) => x.id === id);
  if (!p || !("settings" in p.data)) return null;
  try {
    return withDefaults(p.data.settings);
  } catch {
    return null;
  }
}

export function presetName(id: string | null, saved: readonly PresetDto[]): string | null {
  if (!id) return null;
  const builtIn = getBuiltInPreset(id);
  return builtIn ? tm({ key: builtIn.nameKey }) : (saved.find((x) => x.id === id)?.name ?? null);
}

interface MatchSetupProps {
  groupId: string;
  presets: readonly PresetDto[];
  initialPresetId?: string | null;
  initialZones?: Zone[];
  /** Edit an existing draft/lobby match instead of creating one. */
  editMatch?: MatchInfoDto;
}

export function MatchSetup({ groupId, presets, initialPresetId = null, initialZones = [], editMatch }: MatchSetupProps) {
  const router = useRouter();
  const gamePresets = presets.filter((p) => "settings" in p.data);
  const [presetId, setPresetId] = useState<string | null>(editMatch ? null : initialPresetId);
  const [settings, setSettings] = useState<Settings>(() => editMatch?.settings ?? presetSettings(initialPresetId, presets) ?? structuredClone(DEFAULT_SETTINGS));
  const [zones, setZones] = useState<Zone[]>(() => editMatch?.zones ?? initialZones);
  const [name, setName] = useState(() => editMatch?.name ?? presetName(initialPresetId, presets) ?? t("setup.defaultName"));
  const [nameTouched, setNameTouched] = useState(!!editMatch);
  const [busy, setBusy] = useState<"draft" | "lobby" | "save" | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [savePresetOpen, setSavePresetOpen] = useState(false);
  const [presetNameDraft, setPresetNameDraft] = useState("");

  const issues = useMemo(() => validateSettings(settings, { zones, allowSimulation: editMatch?.simulationAllowed ?? false }), [settings, zones, editMatch]);
  const settingIssues = issues.filter((i) => !i.path.startsWith("zones"));
  const zoneIssues = issues.filter((i) => i.path.startsWith("zones"));
  // Zone-dependent errors (e.g. jail zone missing) are shown but only block the start (server preflight), not saving.
  const blocking = useMemo(() => validateSettings(settings, { allowSimulation: editMatch?.simulationAllowed ?? false }), [settings, editMatch]);
  const blocked = hasErrors(blocking) || !name.trim();

  function choosePreset(id: string) {
    const s = presetSettings(id, presets);
    if (!s) return;
    setPresetId(id);
    setSettings(s);
    if (!nameTouched) setName(presetName(id, presets) ?? name);
  }

  function reset() {
    const before = settings;
    setSettings(structuredClone(DEFAULT_SETTINGS));
    setPresetId(null);
    toast(t("setup.resetDone"), { action: { label: t("common.undo"), onClick: () => setSettings(before) } });
  }

  async function create(openLobby: boolean) {
    setBusy(openLobby ? "lobby" : "draft");
    try {
      const m = await api<MatchInfoDto>(`/groups/${groupId}/matches`, {
        body: { name: name.trim(), settings, ...(zones.length ? { zones } : {}), ...(openLobby ? { quickStart: true } : {}) },
      });
      router.push(`/matches/${m.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
      setBusy(null);
    }
  }

  async function saveEdits() {
    if (!editMatch) return;
    setBusy("save");
    try {
      await api(`/matches/${editMatch.id}/settings`, { method: "PUT", body: { settings } });
      if (JSON.stringify(zones) !== JSON.stringify(editMatch.zones)) await api(`/matches/${editMatch.id}/zones`, { method: "PUT", body: { zones } });
      toast.success(t("setup.saved"));
      router.push(`/matches/${editMatch.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
      setBusy(null);
    }
  }

  async function savePreset() {
    try {
      await api(`/groups/${groupId}/presets`, { body: { kind: "game", name: presetNameDraft.trim(), mode: "hide_seek", data: { settings } } });
      toast.success(t("setup.presetSaved"));
      setSavePresetOpen(false);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  const chips: { id: string; label: string }[] = [
    ...BUILT_IN_PRESETS.map((p) => ({ id: p.id, label: tm({ key: p.nameKey }) })),
    ...gamePresets.map((p) => ({ id: p.id, label: p.name })),
  ];

  return (
    <>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="flex min-w-0 flex-col gap-8">
          {editMatch && (
            <div role="note" className="flex gap-3 rounded-2xl border border-warning/40 bg-warning/8 p-4 text-sm">
              <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
              <p>{t("setup.editWarning")}</p>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <label htmlFor="match-name" className="text-sm font-medium">
              {t("setup.name")}
            </label>
            <Input
              id="match-name"
              maxLength={60}
              value={name}
              autoComplete="off"
              onChange={(e) => {
                setName(e.target.value);
                setNameTouched(true);
              }}
            />
          </div>

          {!editMatch && (
            <Section title={t("setup.preset")}>
              <div role="radiogroup" aria-label={t("setup.preset")} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
                {chips.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    role="radio"
                    aria-checked={presetId === c.id}
                    onClick={() => choosePreset(c.id)}
                    className={cn(
                      "h-10 max-w-[14rem] shrink-0 truncate rounded-full border px-4 text-sm font-medium transition-[background-color,border-color] duration-150 outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                      presetId === c.id ? "border-primary bg-primary/10" : "bg-card hover:bg-muted",
                    )}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </Section>
          )}

          <Section
            title={t("setup.rules")}
            action={
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" onClick={reset}>
                  <RotateCcw aria-hidden />
                  {t("setup.reset")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setPresetNameDraft(name.trim());
                    setSavePresetOpen(true);
                  }}
                >
                  <BookmarkPlus aria-hidden />
                  {t("setup.savePreset")}
                </Button>
              </div>
            }
          >
            <SettingsEditor settings={settings} onChange={setSettings} issues={settingIssues} allowSimulation={editMatch?.simulationAllowed ?? false} />
          </Section>

          <Section title={t("setup.playArea")}>
            <ZoneEditorSlot zones={zones} onChange={setZones} settings={settings} issues={zoneIssues} presetId={presetId ?? undefined} />
          </Section>
        </div>

        <aside aria-label={t("setup.summary")} className="hidden flex-col gap-4 rounded-2xl border bg-card p-5 lg:sticky lg:top-20 lg:flex lg:max-h-[calc(100dvh-11rem)] lg:overflow-y-auto">
          <h2 className="text-base font-semibold">{t("setup.summary")}</h2>
          <RulesSummary settings={settings} zones={zones} />
        </aside>
      </div>

      <StickyFooter wide>
        <button
          type="button"
          onClick={() => setSummaryOpen(true)}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-xl px-2 text-start text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 lg:hidden"
        >
          <ListChecks aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-muted-foreground">{shortRules(settings)}</span>
        </button>
        <div className="hidden flex-1 lg:block" />
        {editMatch ? (
          <Button size="lg" onClick={saveEdits} disabled={blocked || busy !== null}>
            {busy === "save" ? t("common.saving") : t("setup.saveChanges")}
          </Button>
        ) : (
          <>
            <Button size="lg" variant="outline" className="hidden sm:inline-flex" onClick={() => create(false)} disabled={blocked || busy !== null}>
              {busy === "draft" ? t("common.saving") : t("setup.saveDraft")}
            </Button>
            <Button size="lg" onClick={() => create(true)} disabled={blocked || busy !== null}>
              {busy === "lobby" ? t("common.creating") : t("setup.openLobby")}
            </Button>
          </>
        )}
      </StickyFooter>

      <Sheet
        open={summaryOpen}
        onOpenChange={setSummaryOpen}
        title={t("setup.summary")}
        footer={
          !editMatch && (
            <Button variant="outline" onClick={() => create(false)} disabled={blocked || busy !== null}>
              {t("setup.saveDraft")}
            </Button>
          )
        }
      >
        <RulesSummary settings={settings} zones={zones} />
      </Sheet>

      <Sheet
        open={savePresetOpen}
        onOpenChange={setSavePresetOpen}
        title={t("setup.savePresetTitle")}
        description={t("setup.savePresetBody")}
        footer={
          <Button onClick={savePreset} disabled={!presetNameDraft.trim()}>
            {t("common.save")}
          </Button>
        }
      >
        <label htmlFor="new-preset-name" className="sr-only">
          {t("group.presets.name")}
        </label>
        <Input id="new-preset-name" maxLength={40} value={presetNameDraft} onChange={(e) => setPresetNameDraft(e.target.value)} />
      </Sheet>
    </>
  );
}
