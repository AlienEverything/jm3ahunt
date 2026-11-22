"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Layers, MoreHorizontal, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { BUILT_IN_PRESETS, type MatchInfoDto, type PresetDto } from "@/shared";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Sheet } from "@/components/common/Sheet";
import { shortRules } from "@/components/settings/RulesSummary";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { t, tm } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";

export const setupUrl = (groupId: string, q: Record<string, string> = {}) => {
  const qs = new URLSearchParams(q).toString();
  return `/groups/${groupId}/matches/new${qs ? `?${qs}` : ""}`;
};

/** 2×2 built-in presets: tap = lobby in one step; "Customize" opens setup prefilled. */
export function QuickStart({ groupId, disabled }: { groupId: string; disabled?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function start(id: string, name: string) {
    setBusy(id);
    try {
      const m = await api<MatchInfoDto>(`/groups/${groupId}/matches`, { body: { name, presetId: id, quickStart: true } });
      router.push(`/matches/${m.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
      setBusy(null);
    }
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      {BUILT_IN_PRESETS.map((p) => {
        const name = tm({ key: p.nameKey });
        return (
          <div key={p.id} className={cn("flex flex-col rounded-2xl border bg-card transition-opacity", disabled && "opacity-60")}>
            <button
              type="button"
              disabled={disabled || busy !== null}
              onClick={() => start(p.id, name)}
              aria-label={t("group.quickStart.startNamed", { name })}
              className="flex flex-1 flex-col gap-1.5 rounded-t-2xl p-4 text-start outline-none transition-transform duration-150 ease-out focus-visible:ring-3 focus-visible:ring-ring/50 enabled:active:scale-[0.98] disabled:cursor-not-allowed"
            >
              <span className="font-semibold">{busy === p.id ? t("group.quickStart.starting") : name}</span>
              <span className="line-clamp-3 text-xs leading-relaxed text-pretty text-muted-foreground">{tm({ key: p.descriptionKey })}</span>
            </button>
            <Link
              href={setupUrl(groupId, { preset: p.id })}
              aria-disabled={disabled || undefined}
              tabIndex={disabled ? -1 : undefined}
              className={cn("flex min-h-11 items-center gap-1.5 border-t px-4 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50", disabled && "pointer-events-none")}
            >
              <SlidersHorizontal aria-hidden className="size-3.5" />
              {t("group.quickStart.customize")}
            </Link>
          </div>
        );
      })}
    </div>
  );
}

export function SavedPresets({ groupId, presets, canManage, onChanged }: { groupId: string; presets: PresetDto[]; canManage: boolean; onChanged: () => void }) {
  const [renaming, setRenaming] = useState<PresetDto | null>(null);
  const [newName, setNewName] = useState("");
  const [deleting, setDeleting] = useState<PresetDto | null>(null);

  async function run(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn();
      toast.success(ok);
      onChanged();
    } catch (e) {
      toast.error(errorMessage(e));
      throw e;
    }
  }

  return (
    <>
      <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
        {presets.map((p) => {
          const isGame = "settings" in p.data;
          const href = setupUrl(groupId, isGame ? { preset: p.id } : { zones: p.id });
          return (
            <li key={p.id} className="flex min-h-16 items-center gap-1 pe-2">
              <Link href={href} className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 outline-none hover:bg-muted/60 focus-visible:bg-muted">
                <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  {isGame ? <SlidersHorizontal className="size-4" /> : <Layers className="size-4" />}
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate font-medium">{p.name}</span>
                  <span className="truncate text-sm text-muted-foreground">{"settings" in p.data ? shortRules(p.data.settings) : t("group.presets.zoneLayout", { count: p.data.zones.length })}</span>
                </span>
              </Link>
              {canManage && (
                <DropdownMenu>
                  <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={t("group.presets.actionsFor", { name: p.name })} />}>
                    <MoreHorizontal aria-hidden />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-52">
                    <DropdownMenuItem
                      onClick={() => {
                        setNewName(p.name);
                        setRenaming(p);
                      }}
                    >
                      {t("group.presets.rename")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => run(() => api(`/presets/${p.id}/duplicate`, { body: {} }), t("group.presets.duplicated")).catch(() => {})}>{t("group.presets.duplicate")}</DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onClick={() => setDeleting(p)}>
                      {t("common.delete")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </li>
          );
        })}
      </ul>

      <Sheet
        open={renaming !== null}
        onOpenChange={(o) => !o && setRenaming(null)}
        title={t("group.presets.renameTitle")}
        footer={
          <Button
            disabled={!newName.trim()}
            onClick={() =>
              renaming &&
              run(() => api(`/presets/${renaming.id}`, { method: "PATCH", body: { name: newName.trim() } }), t("group.presets.renamed"))
                .then(() => setRenaming(null))
                .catch(() => {})
            }
          >
            {t("common.save")}
          </Button>
        }
      >
        <label htmlFor="preset-name" className="sr-only">
          {t("group.presets.name")}
        </label>
        <Input id="preset-name" maxLength={40} value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
      </Sheet>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t("group.presets.deleteTitle", { name: deleting?.name ?? "" })}
        confirmLabel={t("common.delete")}
        destructive
        onConfirm={() => (deleting ? run(() => api(`/presets/${deleting.id}`, { method: "DELETE" }), t("group.presets.deleted")) : undefined)}
      />
    </>
  );
}
