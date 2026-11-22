"use client";

import { useState } from "react";
import Link from "next/link";
import { Bot, CircleCheck, CircleDashed, Info, MapPinned, MoreHorizontal, Pencil, Shuffle, UserX } from "lucide-react";
import { toast } from "sonner";
import { hasErrors, setAt, validateSettings, type GroupDetailDto, type MatchInfoDto, type MatchView, type Role, type ViewPlayer } from "@/shared";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { CopyButton } from "@/components/common/CopyButton";
import { Section } from "@/components/common/States";
import { StickyFooter } from "@/components/layout/TopBar";
import { MapPreview } from "@/components/map/MapPreview";
import { StateBadge } from "@/components/match/MatchBits";
import { PlayerRow } from "@/components/match/PlayerRow";
import { RulesSummary, shortRules } from "@/components/settings/RulesSummary";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { t, tm } from "@/i18n";
import { api, errorMessage, useApiQuery } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { AckResult, UseMatch } from "@/lib/ws";
import { ConsentSheet } from "./ConsentSheet";
import { GpsCheckCard, useGpsCheck } from "./GpsCheck";

/** Text for a failed ack: server i18n key when present, else its message. */
export const ackError = (r: AckResult) => (r.key ? tm({ key: r.key }) : r.error === "timeout" || r.error === "offline" ? t("lobby.offlineAction") : (r.error ?? t("errors.generic")));

function shareLine(view: MatchView) {
  const p = view.settings.visibility.pings;
  if (!p.enabled) return t("lobby.shareShort.none");
  return t(p.precision === "approx" ? "lobby.shareShort.approx" : "lobby.shareShort.exact", { approxRadiusM: p.approxRadiusM, intervalSec: p.intervalSec });
}

/** Client-side reasons the host cannot start yet; the server re-checks in preflight. */
function startBlockers(view: MatchView, allowSimulation: boolean): string[] {
  const s = view.settings;
  const out: string[] = [];
  const issues = validateSettings(s, { zones: view.zones, playerCount: view.players.length, allowSimulation });
  if (hasErrors(issues)) out.push(...issues.filter((i) => i.severity === "error").map((i) => tm(i)));
  const notReady = view.players.filter((p) => !p.ready).length;
  if (notReady > 0) out.push(t("lobby.block.notReady", { count: notReady }));
  if (s.roles.assignment === "manual") {
    const roles = view.players.map((p) => p.role);
    if (roles.includes(null) || !roles.includes("seeker") || !roles.includes("hider")) out.push(t("lobby.block.roles"));
  }
  return out;
}

export function Lobby({ view, info, match }: { view: MatchView; info: MatchInfoDto; match: UseMatch }) {
  const { send } = match;
  const me = view.me;
  const host = info.canManage;
  const manual = view.settings.roles.assignment === "manual";
  const gps = useGpsCheck();
  const [consentOpen, setConsentOpen] = useState(false);
  const [kicking, setKicking] = useState<ViewPlayer | null>(null);
  const [startIssues, setStartIssues] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  // Invite link needs the group's token (owner/admin only); others share the match link.
  const group = useApiQuery<GroupDetailDto>(host ? `/groups/${info.groupId}` : null);
  const shareUrl = typeof window === "undefined" ? "" : group.data?.inviteToken ? `${window.location.origin}/invite/${group.data.inviteToken}` : `${window.location.origin}/matches/${view.matchId}`;

  const consentOk = me?.consentValid ?? false;
  const sim = view.settings.simulation;
  // Test matches use tapped positions, so a real GPS fix is not required.
  const canReady = consentOk && (gps.ok || sim);
  const botsAllowed = host && sim && info.simulationAllowed && (view.state === "lobby" || view.state === "draft");
  const blockers = view.state === "lobby" ? startBlockers(view, info.simulationAllowed) : [];
  const notReady = view.players.filter((p) => !p.ready).length;

  async function hostOp(key: string, msg: Parameters<UseMatch["send"]>[0]) {
    setBusy(key);
    const r = await send(msg);
    setBusy(null);
    if (!r.ok) toast.error(ackError(r));
    return r;
  }

  async function start() {
    setStartIssues([]);
    const r = await hostOp("start", { t: "host", op: "start" });
    if (!r.ok) setStartIssues(r.issues?.length ? r.issues.map((i) => tm(i)) : [ackError(r)]);
  }

  async function setAssignment(mode: "random" | "manual") {
    if (mode === view.settings.roles.assignment) return;
    setBusy("assign");
    try {
      await api(`/matches/${view.matchId}/settings`, { method: "PUT", body: { settings: setAt(view.settings, "roles.assignment", mode) } });
      toast.success(t("lobby.rulesChanged"));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function toggleReady() {
    const r = await send({ t: "ready", ready: !me?.ready });
    if (!r.ok) toast.error(t("lobby.offlineAction"));
  }

  const roleControl = (p: ViewPlayer) =>
    host && manual && view.state === "lobby" ? (
      <div role="radiogroup" aria-label={t("lobby.roleFor", { name: p.name })} className="inline-flex rounded-lg border p-0.5">
        {(["seeker", "hider"] as Role[]).map((r) => (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={p.role === r}
            onClick={() => p.role !== r && hostOp(`role-${p.userId}`, { t: "host", op: "setRole", userId: p.userId, role: r })}
            className={cn(
              "h-9 rounded-md px-2.5 text-xs font-semibold transition-colors duration-150 outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              p.role === r ? (r === "seeker" ? "bg-seeker/14 text-seeker-ink" : "bg-hider/16 text-hider-ink") : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t(`roles.${r}`)}
          </button>
        ))}
      </div>
    ) : null;

  const kickMenu = (p: ViewPlayer) =>
    host && p.userId !== me?.userId ? (
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={t("lobby.actionsFor", { name: p.name })} />}>
          <MoreHorizontal aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          {p.userId.startsWith("bot_") ? (
            <DropdownMenuItem variant="destructive" onClick={() => hostOp(`bot-${p.userId}`, { t: "host", op: "removeBot", userId: p.userId })}>
              <Bot aria-hidden />
              {t("lobby.sim.removeBot")}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem variant="destructive" onClick={() => setKicking(p)}>
              <UserX aria-hidden />
              {t("lobby.kick")}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    ) : null;

  return (
    <>
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="min-w-0 text-2xl font-semibold tracking-tight break-words">{view.name}</h2>
          <StateBadge state={view.state} />
        </div>
        <p className="text-sm text-muted-foreground">{shortRules(view.settings)}</p>
      </header>

      {sim && (
        <p role="note" className="rounded-2xl bg-warning px-4 py-2 text-center text-sm font-bold tracking-wide text-black uppercase">
          {t("lobby.sim.banner")}
        </p>
      )}

      {view.state === "draft" && (
        <div role="note" className="flex flex-col gap-3 rounded-2xl border border-dashed p-4 sm:flex-row sm:items-center">
          <p className="flex-1 text-sm text-pretty">{t("lobby.draftNote")}</p>
          {host && (
            <Button variant="secondary" onClick={() => hostOp("open", { t: "host", op: "open" })} disabled={busy === "open"}>
              {t("lobby.openLobby")}
            </Button>
          )}
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="flex min-w-0 flex-col gap-8">
          <Section title={t("lobby.players", { count: view.players.length })} action={<span className="text-sm text-muted-foreground tabular">{t("lobby.readyOf", { ready: view.players.length - notReady, count: view.players.length })}</span>}>
            {!manual && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Shuffle aria-hidden className="size-4" />
                {t("lobby.rolesRandom")}
              </p>
            )}
            <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
              {view.players.map((p) => (
                <PlayerRow key={p.userId} player={p} isMe={p.userId === me?.userId} showRole={manual && !(host && view.state === "lobby")} showReady controls={roleControl(p)} actions={kickMenu(p)} />
              ))}
            </ul>
            <p className="flex items-start gap-2 text-sm text-muted-foreground">
              <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>
                {shareLine(view)}{" "}
                <button type="button" onClick={() => setConsentOpen(true)} className="font-medium text-foreground underline underline-offset-4">
                  {t("lobby.shareDetails")}
                </button>
              </span>
            </p>
          </Section>

          {me ? (
            <Section title={t("lobby.yourChecklist")}>
              <ol className="divide-y overflow-hidden rounded-2xl border bg-card">
                <li className="flex items-start gap-3 p-4">
                  {consentOk ? <CircleCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-success" /> : <CircleDashed aria-hidden className="mt-0.5 size-5 shrink-0 text-muted-foreground" />}
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="font-medium">{consentOk ? t("lobby.consentDone") : t("lobby.consentTodo")}</span>
                    <span className="text-sm text-muted-foreground">{consentOk ? t("lobby.consentDoneBody") : me.consent ? t("lobby.consentChanged") : t("lobby.consentTodoBody")}</span>
                  </div>
                  <Button variant={consentOk ? "ghost" : "outline"} size="sm" onClick={() => setConsentOpen(true)}>
                    {consentOk ? t("lobby.review") : t("lobby.reviewAgree")}
                  </Button>
                </li>
                <li className="p-4">
                  <GpsCheckCard status={gps.status} onCheck={gps.check} />
                </li>
              </ol>
              {!canReady && <p className="text-sm text-muted-foreground">{t("lobby.readyNeeds")}</p>}
            </Section>
          ) : (
            <p className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">{t("lobby.spectating")}</p>
          )}

          {host && (
            <Section title={t("lobby.hostControls")}>
              <div className="flex flex-col gap-4 rounded-2xl border bg-card p-4">
                <div className="flex flex-col gap-2">
                  <span id="assign-label" className="text-sm font-medium">
                    {t("settings.roles.assignment.label")}
                  </span>
                  <div role="radiogroup" aria-labelledby="assign-label" className="grid grid-cols-2 gap-2">
                    {(["random", "manual"] as const).map((mode) => (
                      <label key={mode} className="flex min-h-11 cursor-pointer items-center justify-center rounded-xl border px-3 text-sm font-medium has-checked:border-primary has-checked:bg-primary/10 has-focus-visible:ring-3 has-focus-visible:ring-ring/50">
                        <input type="radio" className="sr-only" name="assignment" checked={view.settings.roles.assignment === mode} disabled={busy === "assign" || (view.state !== "lobby" && view.state !== "draft")} onChange={() => setAssignment(mode)} />
                        {t(`settings.roles.assignment.options.${mode}`)}
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">{t("lobby.assignmentNote")}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {manual && view.state === "lobby" && (
                    <Button variant="outline" onClick={() => hostOp("shuffle", { t: "host", op: "assignRoles" })} disabled={busy === "shuffle"}>
                      <Shuffle aria-hidden />
                      {t("lobby.shuffle")}
                    </Button>
                  )}
                  <Button variant="outline" render={<Link href={`/matches/${view.matchId}/edit`} />} nativeButton={false}>
                    <Pencil aria-hidden />
                    {t("lobby.editRules")}
                  </Button>
                  <Button variant="outline" render={<Link href={`/matches/${view.matchId}/edit`} />} nativeButton={false}>
                    <MapPinned aria-hidden />
                    {t("lobby.editPlayArea")}
                  </Button>
                  {botsAllowed && (
                    <Button variant="outline" onClick={() => hostOp("addBot", { t: "host", op: "addBot", count: 1 })} disabled={busy === "addBot"}>
                      <Bot aria-hidden />
                      {t("lobby.sim.addBot")}
                    </Button>
                  )}
                </div>
                {view.state === "lobby" && blockers.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-medium">{t("lobby.cannotStart")}</span>
                    <ul className="list-disc ps-5 text-sm text-muted-foreground">
                      {blockers.map((b, i) => (
                        <li key={i}>{b}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {startIssues.length > 0 && (
                  <ul role="alert" className="flex flex-col gap-1 text-sm font-medium text-danger">
                    {startIssues.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                )}
              </div>
            </Section>
          )}
        </div>

        <aside className="flex flex-col gap-6">
          <Section title={t("lobby.playArea")}>
            <MapPreview zones={view.zones} />
          </Section>
          <Section title={t("lobby.rules")}>
            <div className="rounded-2xl border bg-card p-4">
              <RulesSummary settings={view.settings} zones={view.zones} sections={["match", "capture", "zones"]} />
            </div>
          </Section>
          {shareUrl && <CopyButton value={shareUrl} label={group.data?.inviteToken ? t("lobby.copyInvite") : t("lobby.copyMatchLink")} variant="outline" className="self-start" />}
        </aside>
      </div>

      {me && view.state !== "draft" && (
        <StickyFooter wide>
          <Button size="lg" variant={me.ready ? "outline" : host ? "secondary" : "default"} className={cn(host ? "flex-1 sm:flex-none" : "flex-1")} onClick={toggleReady} disabled={!me.ready && !canReady} aria-pressed={me.ready}>
            {me.ready ? <CircleCheck aria-hidden className="text-success" /> : null}
            {me.ready ? t("lobby.imReady") : t("lobby.setReady")}
          </Button>
          {host && (
            <Button size="lg" className="flex-1" onClick={start} disabled={blockers.length > 0 || busy === "start" || view.state !== "lobby"}>
              {busy === "start" ? t("lobby.starting") : t("lobby.start")}
            </Button>
          )}
        </StickyFooter>
      )}

      <ConsentSheet open={consentOpen} onOpenChange={setConsentOpen} view={view} send={send} />
      <ConfirmDialog
        open={kicking !== null}
        onOpenChange={(o) => !o && setKicking(null)}
        title={t("lobby.kickTitle", { name: kicking?.name ?? "" })}
        body={t("lobby.kickBody")}
        confirmLabel={t("lobby.kick")}
        destructive
        onConfirm={async () => {
          if (!kicking) return;
          const r = await hostOp(`kick-${kicking.userId}`, { t: "host", op: "kick", userId: kicking.userId });
          if (!r.ok) throw new Error(r.error);
        }}
      />
    </>
  );
}
