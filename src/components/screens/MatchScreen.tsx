"use client";

import { useParams } from "next/navigation";
import { WifiOff } from "lucide-react";
import type { MatchInfoDto, MatchState } from "@/shared";
import { ErrorState, LoadingState } from "@/components/common/States";
import { Page, TopBar } from "@/components/layout/TopBar";
import { Lobby } from "@/components/lobby/Lobby";
import { LiveMatchSlot } from "@/components/match/LiveMatchSlot";
import { Results } from "@/components/match/Results";
import { t } from "@/i18n";
import { ApiError, useApiQuery } from "@/lib/api";
import { useMatch, type ConnectionStatus } from "@/lib/ws";

const TERMINAL: MatchState[] = ["finished", "archived"];
const SETUP: MatchState[] = ["draft", "lobby"];

function ConnectionPill({ status }: { status: ConnectionStatus }) {
  if (status === "open") return null;
  return (
    <span role="status" className="inline-flex h-8 items-center gap-1.5 rounded-full bg-muted px-3 text-xs font-medium text-muted-foreground">
      <WifiOff aria-hidden className="size-3.5" />
      {t(`connection.${status}`)}
    </span>
  );
}

/** One route for the whole match lifecycle; switches on the live state. */
export function MatchScreen() {
  const { id } = useParams<{ id: string }>();
  const info = useApiQuery<MatchInfoDto>(`/matches/${encodeURIComponent(id)}`);
  const i = info.data;
  const match = useMatch(i && !TERMINAL.includes(i.state) ? i.id : null);
  const view = match.view;
  const state = view?.state ?? i?.state;
  const wide = state !== undefined && SETUP.includes(state);

  let body: React.ReactNode = null;
  if (info.loading && !i) body = <LoadingState rows={4} />;
  else if (info.error && !i) body = <ErrorState error={info.error} onRetry={info.reload} />;
  else if (i && state && TERMINAL.includes(state)) // Latest rules from the live view so "Play again" copies what was actually played.
    body = <Results info={view ? { ...i, name: view.name, settings: view.settings, zones: view.zones } : i} />;
  else if (match.error && !view) body = <ErrorState error={new ApiError(0, match.error.code, match.error.message)} />;
  else if (i && !view) body = <LoadingState rows={4} />;
  else if (i && view && SETUP.includes(view.state)) body = <Lobby view={view} info={i} match={match} />;
  // Live match is map-first and full-screen: no top bar or content column.
  else if (view) return <LiveMatchSlot view={view} match={match} />;

  return (
    <>
      <TopBar title={view?.name ?? i?.name ?? t("match.title")} back={i ? `/groups/${i.groupId}` : "/dashboard"} wide={wide} actions={i && state && !TERMINAL.includes(state) && <ConnectionPill status={match.status} />} />
      <Page wide={wide}>{body}</Page>
    </>
  );
}
