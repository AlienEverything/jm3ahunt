"use client";

import type { MatchView } from "@/shared";
import { Section } from "@/components/common/States";
import { t } from "@/i18n";
import { formatClock, useServerNow } from "@/lib/hooks";
import type { UseMatch } from "@/lib/ws";
import { PlayerRow, RoleChip } from "./PlayerRow";

export interface LiveMatchSlotProps {
  /** Latest filtered view (state ∈ preflight | countdown | hiding | active | paused). */
  view: MatchView;
  /** Socket: events, prompt, qr, status, send, serverNow. */
  match: UseMatch;
}

/** The deadline the current phase counts down to, if any. */
export function nextDeadline(view: MatchView): number | undefined {
  const c = view.clock;
  if (view.state === "countdown") return c.countdownEndsAt;
  if (view.state === "hiding") return c.hidingEndsAt;
  if (view.state === "active") return c.endsAt;
  return undefined;
}

/**
 * Live match screen.
 * Placeholder until task 4 replaces this file with the map + tabs screen (keep the props).
 */
export function LiveMatchSlot({ view }: LiveMatchSlotProps) {
  const now = useServerNow(500);
  const deadline = nextDeadline(view);
  const me = view.me;
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col items-center gap-2 rounded-2xl border bg-card px-6 py-8 text-center">
        <span className="text-sm font-medium text-muted-foreground">{t(`matchState.${view.state}`)}</span>
        <span className="font-mono text-5xl font-semibold tabular" aria-live="off">
          {deadline ? formatClock(deadline - now) : "–:––"}
        </span>
        {me?.role ? <RoleChip role={me.role} className="mt-1" /> : <span className="text-sm text-muted-foreground">{t("live.noRole")}</span>}
        <p className="mt-2 max-w-sm text-xs text-muted-foreground">{t("live.placeholder")}</p>
      </div>
      <Section title={t("lobby.players", { count: view.players.length })}>
        <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
          {view.players.map((p) => (
            <PlayerRow key={p.userId} player={p} isMe={p.userId === me?.userId} detail={p.status !== "free" ? t(`status.${p.status}`) : undefined} />
          ))}
        </ul>
      </Section>
    </div>
  );
}
