"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RotateCcw, Trophy } from "lucide-react";
import { toast } from "sonner";
import type { MatchInfoDto, MatchResultsDto } from "@/shared";
import { ErrorState, LoadingState, Section } from "@/components/common/States";
import { UserAvatar } from "@/components/common/UserAvatar";
import { StickyFooter } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/button";
import { formatDuration, hasMessage, t, tm, type MessageParams } from "@/i18n";
import { api, errorMessage, useApiQuery } from "@/lib/api";
import { formatClock } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { RoleChip } from "./PlayerRow";

const flatParams = (p: MatchResultsDto["highlights"][number]["payload"]): MessageParams =>
  Object.fromEntries(
    Object.entries(p).flatMap(([k, v]) => (typeof v === "string" || typeof v === "number" ? [[k, v]] : Array.isArray(v) ? [[k, v.join(", ")]] : [])),
  );

export function Results({ info }: { info: MatchInfoDto }) {
  const router = useRouter();
  const q = useApiQuery<MatchResultsDto>(`/matches/${info.id}/results`);
  const [busy, setBusy] = useState(false);
  const r = q.data;

  async function playAgain() {
    setBusy(true);
    try {
      const m = await api<MatchInfoDto>(`/groups/${info.groupId}/matches`, { body: { name: info.name, settings: info.settings, ...(info.zones.length ? { zones: info.zones } : {}) } });
      router.push(`/matches/${m.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
      setBusy(false);
    }
  }

  if (q.loading && !r) return <LoadingState rows={4} />;
  if (q.error && !r) return <ErrorState error={q.error} onRetry={q.reload} />;
  if (!r) return null;

  const { result } = r;
  const durationSec = r.match.durationSec ?? (r.match.startedAt ? Math.round((result.endedAt - r.match.startedAt) / 1000) : null);
  const winnerTone = result.winner === "seekers" ? "border-seeker bg-seeker/8" : result.winner === "hiders" ? "border-hider bg-hider/8" : "border-border bg-card";
  const players = [...r.players].sort((a, b) => b.stats.captures - a.stats.captures || b.stats.survivedSec - a.stats.survivedSec);

  return (
    <>
      <div className={cn("flex flex-col items-center gap-2 rounded-2xl border-2 px-6 py-8 text-center", winnerTone)}>
        <Trophy aria-hidden className={cn("size-7", result.winner === "seekers" ? "text-seeker-ink" : result.winner === "hiders" ? "text-hider-ink" : "text-muted-foreground")} />
        <h2 className="text-3xl font-semibold tracking-tight text-balance">{t(`results.winner.${result.winner}`)}</h2>
        <p className="text-sm text-muted-foreground">{t(`results.reason.${result.reason}`)}</p>
        <dl className="mt-3 flex flex-wrap justify-center gap-x-8 gap-y-2">
          {durationSec != null && (
            <div className="flex flex-col">
              <dt className="text-xs text-muted-foreground">{t("results.duration")}</dt>
              <dd className="font-mono text-xl font-semibold tabular">{formatClock(durationSec * 1000)}</dd>
            </div>
          )}
          {result.scores && (
            <>
              <div className="flex flex-col">
                <dt className="text-xs text-muted-foreground">{t("results.seekerScore")}</dt>
                <dd className="font-mono text-xl font-semibold tabular">{result.scores.seekers}</dd>
              </div>
              <div className="flex flex-col">
                <dt className="text-xs text-muted-foreground">{t("results.hiderScore")}</dt>
                <dd className="font-mono text-xl font-semibold tabular">{result.scores.hiders}</dd>
              </div>
            </>
          )}
        </dl>
      </div>

      <Section title={t("results.players")}>
        <div className="overflow-x-auto rounded-2xl border bg-card">
          <table className="w-full min-w-[32rem] text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                <th scope="col" className="px-4 py-3 text-start font-medium">
                  {t("results.player")}
                </th>
                <th scope="col" className="px-2 py-3 text-end font-medium">
                  {t("results.captures")}
                </th>
                <th scope="col" className="px-2 py-3 text-end font-medium">
                  {t("results.caught")}
                </th>
                <th scope="col" className="px-2 py-3 text-end font-medium">
                  {t("results.rescues")}
                </th>
                <th scope="col" className="px-4 py-3 text-end font-medium">
                  {t("results.survived")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {players.map((p) => (
                <tr key={p.userId}>
                  <th scope="row" className="px-4 py-3 text-start font-normal">
                    <div className="flex min-w-0 items-center gap-3">
                      <UserAvatar avatar={p.avatar} name={p.displayName} size="sm" />
                      <span className="max-w-[10rem] truncate font-medium">{p.displayName}</span>
                      {p.finalRole && <RoleChip role={p.finalRole} />}
                    </div>
                  </th>
                  <td className="px-2 py-3 text-end font-mono tabular">{p.stats.captures}</td>
                  <td className="px-2 py-3 text-end font-mono tabular">{p.stats.timesCaptured}</td>
                  <td className="px-2 py-3 text-end font-mono tabular">{p.stats.rescues}</td>
                  <td className="px-4 py-3 text-end font-mono tabular">{formatDuration(p.stats.survivedSec)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {r.highlights.length > 0 && (
        <Section title={t("results.highlights")}>
          <ol className="flex flex-col gap-2 rounded-2xl border bg-card p-4 text-sm">
            {r.highlights.map((h, i) => {
              const key = `events.${h.type}`;
              return (
                <li key={i} className="flex gap-3">
                  <span className="w-14 shrink-0 font-mono text-xs text-muted-foreground tabular">{r.match.startedAt ? formatClock(Math.max(0, h.at - r.match.startedAt)) : ""}</span>
                  <span>{hasMessage(key) ? tm({ key, params: flatParams(h.payload) }) : h.type}</span>
                </li>
              );
            })}
          </ol>
        </Section>
      )}

      <StickyFooter>
        <Button size="lg" variant={info.canManage ? "outline" : "default"} className="flex-1" render={<Link href={`/groups/${info.groupId}`} />} nativeButton={false}>
          {t("results.backToGroup")}
        </Button>
        {info.canManage && (
          <Button size="lg" className="flex-1" onClick={playAgain} disabled={busy}>
            <RotateCcw aria-hidden />
            {t("results.playAgain")}
          </Button>
        )}
      </StickyFooter>
    </>
  );
}
