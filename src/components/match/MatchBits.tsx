import Link from "next/link";
import { ChevronRight, Trophy } from "lucide-react";
import type { ActiveMatchDto, MatchState, MatchSummaryDto } from "@/shared";
import { formatDuration, locale, t } from "@/i18n";
import { cn } from "@/lib/utils";

const LIVE: MatchState[] = ["preflight", "countdown", "hiding", "active", "paused"];
export const isLiveState = (s: MatchState) => LIVE.includes(s);

export function StateBadge({ state, className }: { state: MatchState; className?: string }) {
  const live = isLiveState(state);
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold",
        live ? "bg-primary/12 text-seeker-ink" : state === "lobby" ? "bg-hider/14 text-hider-ink" : "bg-muted text-muted-foreground",
        className,
      )}
    >
      {live && <span aria-hidden className="size-1.5 rounded-full bg-primary" />}
      {t(`matchState.${state}`)}
    </span>
  );
}

/** Highlighted "current match" row (accent border). */
export function CurrentMatchCard({ match, groupName }: { match: ActiveMatchDto; groupName?: string }) {
  return (
    <Link
      href={`/matches/${match.id}`}
      className="flex min-h-16 items-center gap-3 rounded-2xl border-2 border-primary bg-card px-4 py-3 outline-none transition-transform duration-150 ease-out focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.99]"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-semibold">{match.name}</span>
        <span className="truncate text-sm text-muted-foreground">
          {groupName ? `${groupName} · ` : ""}
          {t("match.readyCount", { ready: match.readyCount, count: match.playerCount })}
        </span>
      </div>
      <StateBadge state={match.state} />
      <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground rtl:rotate-180" />
    </Link>
  );
}

const dateFmt = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" });

export function ResultList({ matches, showGroup }: { matches: (MatchSummaryDto & { groupName?: string })[]; showGroup?: boolean }) {
  return (
    <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
      {matches.map((m) => (
        <li key={m.id}>
          <Link href={`/matches/${m.id}`} className="flex min-h-16 items-center gap-3 px-4 py-3 outline-none hover:bg-muted/60 focus-visible:bg-muted">
            <span aria-hidden className={cn("flex size-9 shrink-0 items-center justify-center rounded-full", m.result?.winner === "seekers" ? "bg-seeker/12 text-seeker-ink" : m.result?.winner === "hiders" ? "bg-hider/14 text-hider-ink" : "bg-muted text-muted-foreground")}>
              <Trophy className="size-4" />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate font-medium">{m.name}</span>
              <span className="truncate text-sm text-muted-foreground">
                {[showGroup && m.groupName, m.result ? t(`results.winnerShort.${m.result.winner}`) : t(`matchState.${m.state}`), m.durationSec != null && formatDuration(m.durationSec), t("units.players", { n: m.playerCount })]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </div>
            <span className="shrink-0 font-mono text-xs text-muted-foreground tabular">{dateFmt.format(m.endedAt ?? m.createdAt)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
