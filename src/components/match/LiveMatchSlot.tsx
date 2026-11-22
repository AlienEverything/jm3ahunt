"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, CircleAlert, Hand, LifeBuoy, LogOut, Map as MapIcon, MoreHorizontal, OctagonX, ScrollText, ShieldAlert, Target, Users, Wifi, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { elapsedActiveMs, findMainZone, shapeCenter, zoneStateAt, type LngLat, type MatchEvent, type MatchView, type ViewPlayer } from "@/shared";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Sheet } from "@/components/common/Sheet";
import { ConsentSheet } from "@/components/lobby/ConsentSheet";
import { ackError } from "@/components/lobby/Lobby";
import { RulesSummary } from "@/components/settings/RulesSummary";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { t, tm, type MessageParams } from "@/i18n";
import { useGps, useWakeLock, type GpsState } from "@/lib/gps";
import { formatClock, useServerNow } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import type { ConnectionStatus, UseMatch } from "@/lib/ws";
import { LiveMap } from "./LiveMap";
import { PlayerRow, RoleChip } from "./PlayerRow";
import { RoleReveal } from "./RoleReveal";
import { PromptSheet, RescueSheet, ShowCodeSheet, TagSheet, vibrate } from "./TagFlows";

export interface LiveMatchSlotProps {
  /** Latest filtered view (state ∈ preflight | countdown | hiding | active | paused). */
  view: MatchView;
  /** Socket: events, prompt, qr, status, send, serverNow. */
  match: UseMatch;
}

/** The deadline the current phase counts down to, if any. */
export function nextDeadline(view: MatchView): number | undefined {
  const c = view.clock;
  const s = view.state === "paused" ? c.pausedFrom : view.state;
  if (s === "countdown") return c.countdownEndsAt;
  if (s === "hiding") return c.hidingEndsAt;
  if (s === "active") return c.endsAt;
  return undefined;
}

type Tab = "map" | "players" | "goals" | "events" | "rules";
const HIDDEN_EVENTS = new Set(["player.consented", "player.ready", "settings.changed"]);

/** `events.<type>` with player ids in the payload swapped for names. */
export function eventText(e: MatchEvent, players: Map<string, ViewPlayer>): string {
  const name = (v: unknown) => (typeof v === "string" ? (players.get(v)?.name ?? t("live.someone")) : t("live.someone"));
  const p = e.payload;
  const params: MessageParams = { name: name(p.userId), seeker: name(p.seekerId), hider: name(p.hiderId), rescuer: name(p.rescuerId) };
  return tm({ key: `events.${e.type}`, params });
}

const GPS_TONE: Record<GpsState, string> = { live: "bg-success", delayed: "bg-warning", stale: "bg-danger", off: "bg-muted-foreground/50", denied: "bg-danger", unavailable: "bg-danger" };

function StatusPill({ status, gps, acc, sim }: { status: ConnectionStatus; gps: GpsState; acc?: number; sim: boolean }) {
  return (
    <span role="status" className="pointer-events-auto inline-flex h-9 items-center gap-2 rounded-full border bg-background/92 px-3 text-xs font-medium shadow-sm backdrop-blur">
      {status === "open" ? <Wifi aria-hidden className="size-3.5 text-success" /> : <WifiOff aria-hidden className="size-3.5 text-danger" />}
      <span className={status === "open" ? "sr-only" : ""}>{t(`connection.${status}`)}</span>
      <span aria-hidden className={cn("size-2 rounded-full", GPS_TONE[gps])} />
      <span className="tabular">
        {sim && gps !== "off" ? t("live.gps.sim") : t(`live.gps.${gps}`)}
        {acc !== undefined && gps === "live" && !sim ? ` ±${Math.round(acc)} m` : ""}
      </span>
    </span>
  );
}

function Banner({ tone, icon: Icon, children }: { tone: "warning" | "danger" | "info"; icon: typeof CircleAlert; children: React.ReactNode }) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "pointer-events-auto flex items-start gap-2 rounded-2xl border px-3 py-2.5 text-sm font-medium shadow-sm backdrop-blur",
        tone === "danger" && "border-danger bg-danger text-white dark:text-black",
        tone === "warning" && "border-warning/50 bg-background/95",
        tone === "info" && "bg-background/95",
      )}
    >
      <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", tone === "warning" && "text-warning")} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function useDisputed(events: MatchEvent[]) {
  return useMemo(() => {
    const open = new Map<string, MatchEvent>();
    for (const e of events) {
      const id = typeof e.payload.captureId === "string" ? e.payload.captureId : null;
      if (!id) continue;
      if (e.type === "capture.disputed") open.set(id, e);
      else if (e.type === "capture.resolved" || e.type === "capture.confirmed" || e.type === "capture.rejected" || e.type === "capture.expired") open.delete(id);
    }
    return [...open.values()];
  }, [events]);
}

/** Toasts + vibration for key events that arrive while the screen is open (not the backlog). */
function useEventAlerts(view: MatchView, events: MatchEvent[], players: Map<string, ViewPlayer>) {
  const seen = useRef<number | null>(null);
  const meId = view.me?.userId;
  const n = view.settings.notifications;
  useEffect(() => {
    const last = events.at(-1)?.seq ?? 0;
    if (seen.current === null) {
      seen.current = last;
      return;
    }
    const fresh = events.filter((e) => e.seq > (seen.current ?? 0));
    seen.current = last;
    const buzz = (p: number | number[]) => n.vibrate && vibrate(p);
    for (const e of fresh) {
      const text = eventText(e, players);
      const mine = e.payload.userId === meId || e.payload.hiderId === meId || e.payload.seekerId === meId;
      switch (e.type) {
        case "match.hiding":
        case "match.active":
          if (n.gameStart) {
            toast(text);
            buzz([120, 60, 120]);
          }
          break;
        case "match.paused":
        case "match.emergency":
          toast.warning(text);
          buzz(200);
          break;
        case "match.resumed":
        case "match.overtime":
          toast(text);
          break;
        case "zone.warning":
        case "zone.transitionStart":
          if (n.zoneShrink) {
            toast.warning(text);
            buzz([80, 40, 80]);
          }
          break;
        case "capture.confirmed":
        case "player.jailed":
        case "player.frozen":
        case "player.rescued":
        case "player.released":
        case "player.converted":
        case "player.eliminated":
          if (n.playerTagged || mine) {
            toast(text);
            if (mine) buzz([200, 80, 200]);
          }
          break;
        case "capture.disputed":
        case "capture.rejected":
        case "capture.expired":
          if (mine || view.me?.isHost) toast.warning(text);
          break;
        case "boundary.warning":
          toast.error(text);
          buzz([300, 100, 300]);
          break;
        case "boundary.cleared":
          toast.success(text);
          break;
        case "ping":
          toast(t("live.pingToast"));
          buzz(40);
          break;
      }
    }
  }, [events, players, meId, n, view.me?.isHost]);
}

export function LiveMatchSlot({ view, match }: LiveMatchSlotProps) {
  const router = useRouter();
  const now = useServerNow(500);
  const me = view.me;
  const sim = view.settings.simulation;
  const players = useMemo(() => new Map(view.players.map((p) => [p.userId, p])), [view.players]);
  const [tab, setTab] = useState<Tab>("map");
  const [sheet, setSheet] = useState<null | "tag" | "code" | "rescueCode" | "rescue" | "host" | "consent">(null);
  const [confirm, setConfirm] = useState<null | "emergency" | "leave" | "end">(null);
  const [awake, setAwake] = useState(false);
  const wake = useWakeLock(awake);
  const main = findMainZone(view.zones);
  const [simPos, setSimPos] = useState<LngLat | null>(() => (sim && main ? shapeCenter(main.shape) : null));
  const { send } = match;

  const sendLoc = useCallback((m: Parameters<typeof send>[0]) => void send(m), [send]);
  const onResume = useCallback(() => toast(t("live.gps.resumed")), []);
  const gps = useGps({ tracking: !!me?.tracking, send: sendLoc, staleAfterSec: view.settings.location.staleAfterSec, simulation: sim, simPosition: simPos, onResume });
  useEventAlerts(view, match.events, players);

  const deniedOnce = useRef(false);
  useEffect(() => {
    if (gps.state === "denied" && !deniedOnce.current) {
      deniedOnce.current = true;
      toast.error(t("live.gps.deniedToast"));
    }
  }, [gps.state]);

  const deadline = nextDeadline(view);
  const at = view.state === "paused" ? (view.clock.pausedAt ?? now) : now;
  const overtime = view.state === "active" && deadline !== undefined && now > deadline;
  const phaseState = view.state === "paused" ? (view.clock.pausedFrom ?? "active") : view.state;
  const timerLabel = view.state === "paused" ? t("matchState.paused") : overtime ? t("live.timer.overtime") : phaseState === "countdown" ? t("live.timer.countdown") : phaseState === "hiding" ? t("live.timer.hiding") : phaseState === "active" ? t("live.timer.active") : t(`matchState.${view.state}`);

  // Zone banner (computed from the shared timeline with server time; no per-tick broadcasts).
  const dyn = main && main.behavior.kind !== "static" && phaseState === "active" ? zoneStateAt(main, elapsedActiveMs(view.clock, now)) : null;
  const moving = main?.behavior.kind === "moving";
  let zoneBanner: string | null = null;
  if (dyn?.phase === "transition" && dyn.msUntilNextChange !== null) zoneBanner = t(moving ? "live.zone.moving" : "live.zone.shrinking", { time: formatClock(dyn.msUntilNextChange) });
  else if (dyn?.warning && dyn.msUntilNextChange !== null) zoneBanner = t(moving ? "live.zone.movesIn" : "live.zone.shrinksIn", { time: formatClock(dyn.msUntilNextChange) });

  const boundary = me?.boundary;
  const restricted = boundary?.zoneId ? view.zones.find((z) => z.id === boundary.zoneId && z.type === "restricted") : undefined;
  const noSignal = view.locations.filter((l) => l.precision === "none");

  const feed = useMemo(() => match.events.filter((e) => !HIDDEN_EVENTS.has(e.type)).toReversed(), [match.events]);
  const disputed = useDisputed(match.events);
  const methods = view.settings.capture.methods;
  const rescue = view.settings.jail.rescue;
  const jailedMates = view.players.filter((p) => p.status === "jailed" && p.userId !== me?.userId);
  const myPending = view.pendingCapture && view.pendingCapture.seekerId === me?.userId ? view.pendingCapture : undefined;
  const freeHiders = view.players.filter((p) => p.role === "hider" && p.status === "free").length;
  const tabs: { id: Tab; icon: typeof MapIcon; show: boolean }[] = [
    { id: "map", icon: MapIcon, show: true },
    { id: "players", icon: Users, show: true },
    { id: "goals", icon: Target, show: !!me?.role },
    { id: "events", icon: Bell, show: feed.length > 0 },
    { id: "rules", icon: ScrollText, show: true },
  ];

  async function run(msg: Parameters<typeof send>[0]) {
    const r = await send(msg);
    if (!r.ok) {
      toast.error(ackError(r));
      throw new Error(r.error);
    }
    return r;
  }

  // ── primary contextual action (bottom-start) ──
  let action: React.ReactNode = null;
  if (me && me.role) {
    if (me.status === "jailed") {
      action = (
        <div className="flex flex-col gap-2 rounded-2xl border bg-background/95 p-3 shadow-sm backdrop-blur">
          <span className="flex items-center gap-2 font-semibold">
            <ShieldAlert aria-hidden className="size-4 text-danger" />
            {t("live.jail.title")}
          </span>
          {me.jailEndsAt && <span className="text-sm tabular">{t("live.jail.release", { time: formatClock(me.jailEndsAt - at) })}</span>}
          {rescue.enabled && <span className="text-xs text-muted-foreground">{rescue.method === "qr" ? t("live.jail.rescueQr") : t("live.jail.rescueConfirm")}</span>}
          {rescue.enabled && rescue.method === "qr" && (
            <Button size="sm" variant="outline" onClick={() => setSheet("rescueCode")}>
              {t("live.jail.showCode")}
            </Button>
          )}
        </div>
      );
    } else if (me.status === "frozen") {
      action = (
        <div className="rounded-2xl border bg-background/95 p-3 shadow-sm backdrop-blur">
          <span className="font-semibold">{t("live.frozen", { time: me.freezeEndsAt ? formatClock(me.freezeEndsAt - at) : "–" })}</span>
        </div>
      );
    } else if (me.status !== "free") {
      action = <div className="rounded-2xl border bg-background/95 p-3 text-sm font-medium shadow-sm backdrop-blur">{t(`live.out.${me.status}`)}</div>;
    } else if (me.role === "seeker") {
      action = myPending ? (
        <div className="rounded-2xl border bg-background/95 p-3 text-sm shadow-sm backdrop-blur" role="status">
          <span className="font-semibold">{t(myPending.status === "disputed" ? "live.tag.disputed" : "live.tag.pending", { name: players.get(myPending.hiderId)?.name ?? "" })}</span>
          {myPending.status === "pending" && <span className="block tabular text-muted-foreground">{formatClock(myPending.expiresAt - now)}</span>}
        </div>
      ) : (
        <Button size="lg" className="pointer-events-auto h-12 rounded-2xl px-5 shadow-md" disabled={view.state !== "active"} onClick={() => setSheet("tag")}>
          <Hand aria-hidden />
          {view.state === "active" ? t("live.tag.cta") : phaseState !== "active" && view.clock.activeStartedAt ? t("live.tag.releasedIn", { time: formatClock(view.clock.activeStartedAt - at) }) : t("live.tag.cta")}
        </Button>
      );
    } else {
      action = (
        <div className="flex flex-col items-start gap-2">
          {rescue.enabled && jailedMates.length > 0 && me.rescuesLeft > 0 && (
            <Button size="lg" variant="secondary" className="pointer-events-auto h-12 rounded-2xl shadow-md" onClick={() => setSheet("rescue")}>
              <LifeBuoy aria-hidden />
              {t("live.rescue.cta", { count: jailedMates.length })}
            </Button>
          )}
          {(methods.includes("qr") || methods.includes("code")) && (
            <Button size="lg" className="pointer-events-auto h-12 rounded-2xl px-5 shadow-md" onClick={() => setSheet("code")}>
              {t("live.qr.cta")}
            </Button>
          )}
        </div>
      );
    }
  }

  // ── goals ──
  const goals: string[] = [];
  if (me?.role === "seeker") {
    goals.push(t("live.goals.seeker", { count: freeHiders }));
    if (view.clock.endsAt && phaseState === "active") goals.push(t("live.goals.timeLeft", { time: formatClock(view.clock.endsAt - at) }));
  } else if (me?.role === "hider") {
    if (me.status === "jailed") goals.push(rescue.enabled ? t("live.goals.jailed") : t("live.goals.jailedNoRescue"));
    else if (me.status === "free" && view.clock.endsAt) goals.push(t("live.goals.survive", { min: Math.max(1, Math.ceil((view.clock.endsAt - at) / 60_000)) }));
    if (rescue.enabled && me.status === "free" && jailedMates.length > 0) goals.push(t("live.goals.rescue", { count: jailedMates.length }));
  }
  if (me?.role) goals.push(t("live.goals.stayInside"));
  if (view.scores) goals.push(t("live.goals.scores", { seekers: view.scores.seekers, hiders: view.scores.hiders }));

  const pausedBy = useMemo(() => match.events.findLast((e) => e.type === "match.paused" || e.type === "match.emergency"), [match.events]);

  return (
    <div className="fixed inset-0 z-30 flex h-dvh flex-col overflow-hidden overscroll-none bg-background pt-safe">
      {sim && (
        <div className="shrink-0 bg-warning px-3 py-1 text-center text-xs font-bold tracking-wide text-black uppercase" role="note">
          {t("live.sim.banner")}
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        <LiveMap view={view} now={at} fix={gps.fix} onSimTap={sim && me?.tracking ? setSimPos : undefined} className="absolute inset-0" />

        {tab !== "map" && (
          <section className="absolute inset-0 z-10 overflow-y-auto overscroll-contain bg-background px-4 pt-28 pb-8" aria-labelledby="live-panel-title">
            <div className="mx-auto flex max-w-2xl flex-col gap-4">
              <h2 id="live-panel-title" className="text-xl font-semibold tracking-tight">
                {t(`live.tabs.${tab}`)}
              </h2>
              {tab === "players" && (
                <>
                  {view.scores && (
                    <p className="flex gap-6 rounded-2xl border bg-card p-4 font-mono text-lg tabular">
                      <span className="text-seeker-ink">
                        {t("results.seekerScore")} {view.scores.seekers}
                      </span>
                      <span className="text-hider-ink">
                        {t("results.hiderScore")} {view.scores.hiders}
                      </span>
                    </p>
                  )}
                  <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
                    {view.players.map((p) => (
                      <PlayerRow key={p.userId} player={p} isMe={p.userId === me?.userId} detail={`${t(`status.${p.status}`)} · ${t(`presence.${p.presence}`)}`} />
                    ))}
                  </ul>
                </>
              )}
              {tab === "goals" && (
                <ul className="flex flex-col gap-2">
                  {goals.map((g, i) => (
                    <li key={i} className="flex gap-3 rounded-2xl border bg-card p-4 text-base font-medium text-pretty">
                      <Target aria-hidden className="mt-1 size-4 shrink-0 text-primary" />
                      {g}
                    </li>
                  ))}
                </ul>
              )}
              {tab === "events" && (
                <ol className="flex flex-col divide-y rounded-2xl border bg-card">
                  {feed.map((e) => (
                    <li key={e.seq} className="flex gap-3 px-4 py-3 text-sm">
                      <time className="w-16 shrink-0 pt-0.5 font-mono text-xs whitespace-nowrap text-muted-foreground tabular" dateTime={new Date(e.at).toISOString()}>
                        {new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </time>
                      <span className="min-w-0 flex-1 break-words">{eventText(e, players)}</span>
                    </li>
                  ))}
                </ol>
              )}
              {tab === "rules" && (
                <div className="rounded-2xl border bg-card p-4">
                  <RulesSummary settings={view.settings} zones={view.zones} sections={["sharing", "match", "capture", "zones"]} />
                </div>
              )}
            </div>
          </section>
        )}

        {/* HUD: top-start phase/role/timer, top-end status + emergency + menu */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-col gap-2 p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="pointer-events-auto flex min-w-0 flex-col rounded-2xl border bg-background/92 px-3.5 py-2 shadow-sm backdrop-blur">
              <span className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground">
                <span className="truncate">{timerLabel}</span>
                {me?.role && <RoleChip role={me.role} className="h-5 px-2 text-[11px]" />}
              </span>
              <span className="font-mono text-3xl leading-tight font-semibold tabular" aria-live="off">
                {deadline ? formatClock(overtime ? 0 : deadline - at) : "–:––"}
              </span>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2">
              <StatusPill status={match.status} gps={gps.state} acc={gps.fix?.acc} sim={sim} />
              <div className="flex gap-2">
                <button type="button" onClick={() => setConfirm("emergency")} className="pointer-events-auto flex h-11 items-center gap-1.5 rounded-xl border border-danger bg-danger px-3 text-sm font-semibold text-white shadow-sm dark:text-black outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97]">
                  <OctagonX aria-hidden className="size-4" />
                  {t("live.emergency.button")}
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger render={<button type="button" className="pointer-events-auto flex size-11 items-center justify-center rounded-xl border bg-background/92 shadow-sm backdrop-blur outline-none focus-visible:ring-3 focus-visible:ring-ring/50" aria-label={t("live.menu")} />}>
                    <MoreHorizontal aria-hidden className="size-5" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-56">
                    {wake.supported && (
                      <DropdownMenuCheckboxItem checked={awake} onCheckedChange={setAwake} className="min-h-11">
                        {t("live.awake")}
                      </DropdownMenuCheckboxItem>
                    )}
                    {me?.isHost && (
                      <DropdownMenuItem className="min-h-11" onClick={() => setSheet("host")}>
                        {t("live.host.title")}
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem className="min-h-11" onClick={() => router.push(`/groups/${view.groupId}`)}>
                      {t("live.backToGroup")}
                    </DropdownMenuItem>
                    {me && me.status !== "withdrawn" && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" className="min-h-11" onClick={() => setConfirm("leave")}>
                          <LogOut aria-hidden />
                          {t("live.leave.button")}
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>
          {tab === "map" && (
            <div className="flex max-w-md flex-col gap-2">
              {boundary?.state === "warning" && boundary.warningEndsAt && (
                <Banner tone="danger" icon={CircleAlert}>
                  <p className="font-semibold">{restricted ? t("live.boundary.restrictedTitle", { name: restricted.name }) : t("live.boundary.title")}</p>
                  <p className="tabular">{t("live.boundary.body", { time: formatClock(boundary.warningEndsAt - at) })}</p>
                </Banner>
              )}
              {boundary?.state === "penalized" && (
                <Banner tone="warning" icon={CircleAlert}>
                  {t("live.boundary.penalized")}
                </Banner>
              )}
              {zoneBanner && (
                <Banner tone="warning" icon={CircleAlert}>
                  <span className="tabular">{zoneBanner}</span>
                </Banner>
              )}
              {noSignal.length > 0 && (
                <Banner tone="info" icon={WifiOff}>
                  {t("live.noSignal", { names: noSignal.map((l) => players.get(l.userId)?.name ?? "").join(", ") })}
                </Banner>
              )}
              {me && !me.consentValid && me.status !== "withdrawn" && me.status !== "eliminated" && (
                <Banner tone="warning" icon={CircleAlert}>
                  <p>{t("live.notSharing")}</p>
                  <Button size="sm" variant="outline" className="mt-2" onClick={() => setSheet("consent")}>
                    {t("live.shareAgain")}
                  </Button>
                </Banner>
              )}
              {!me && (
                <Banner tone="info" icon={Users}>
                  {t("live.spectating")}
                </Banner>
              )}
            </div>
          )}
        </div>

        {tab === "map" && action && <div className="pointer-events-none absolute start-3 bottom-8 z-20 max-w-[calc(100%-5.5rem)] [&>*]:pointer-events-auto">{action}</div>}

        {view.state === "paused" && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/80 p-6 backdrop-blur-sm" role="alertdialog" aria-labelledby="paused-title">
            <div className="flex max-w-sm flex-col items-center gap-3 rounded-3xl border bg-card p-6 text-center shadow-lg">
              <h2 id="paused-title" className="text-2xl font-semibold">
                {pausedBy?.type === "match.emergency" ? t("live.paused.emergency") : t("live.paused.title")}
              </h2>
              <p className="text-sm text-muted-foreground">{pausedBy ? eventText(pausedBy, players) : t("live.paused.body")}</p>
              <p className="text-sm text-muted-foreground">{t("live.paused.frozen")}</p>
              {me?.isHost ? (
                <div className="mt-2 flex w-full flex-col gap-2">
                  <Button size="lg" onClick={() => run({ t: "host", op: "resume" }).catch(() => {})}>
                    {t("live.host.resume")}
                  </Button>
                  <Button size="lg" variant="outline" onClick={() => setConfirm("end")}>
                    {t("live.host.end")}
                  </Button>
                </div>
              ) : (
                <p className="text-sm font-medium">{t("live.paused.waiting")}</p>
              )}
            </div>
          </div>
        )}
      </div>

      <nav aria-label={t("live.tabs.label")} className="z-40 shrink-0 border-t bg-background pb-safe">
        <div role="tablist" className="mx-auto flex max-w-2xl">
          {tabs
            .filter((x) => x.show)
            .map(({ id, icon: Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={cn("flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium outline-none focus-visible:bg-muted", tab === id ? "text-foreground" : "text-muted-foreground")}
              >
                <Icon aria-hidden className={cn("size-5", tab === id && "text-primary")} />
                {t(`live.tabs.${id}`)}
              </button>
            ))}
        </div>
      </nav>

      <TagSheet open={sheet === "tag"} onOpenChange={(o) => setSheet(o ? "tag" : null)} view={view} match={match} />
      <ShowCodeSheet open={sheet === "code" || sheet === "rescueCode"} onOpenChange={(o) => !o && setSheet(null)} match={match} rescue={sheet === "rescueCode"} />
      <RescueSheet open={sheet === "rescue"} onOpenChange={(o) => setSheet(o ? "rescue" : null)} view={view} match={match} />
      <PromptSheet match={match} />
      <ConsentSheet open={sheet === "consent"} onOpenChange={(o) => setSheet(o ? "consent" : null)} view={view} send={send} />

      <Sheet open={sheet === "host"} onOpenChange={(o) => setSheet(o ? "host" : null)} title={t("live.host.title")} description={t("live.host.body")}>
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            {view.state === "paused" ? (
              <Button size="lg" onClick={() => run({ t: "host", op: "resume" }).catch(() => {})}>
                {t("live.host.resume")}
              </Button>
            ) : (
              <Button size="lg" variant="outline" onClick={() => run({ t: "host", op: "pause" }).catch(() => {})}>
                {t("live.host.pause")}
              </Button>
            )}
            <Button size="lg" variant="destructive" onClick={() => setConfirm("end")}>
              {t("live.host.end")}
            </Button>
          </div>
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">{t("live.host.disputes")}</h3>
            {disputed.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("live.host.noDisputes")}</p>
            ) : (
              <ul className="divide-y rounded-2xl border">
                {disputed.map((e) => (
                  <li key={String(e.payload.captureId)} className="flex flex-col gap-2 p-3">
                    <span className="text-sm">{eventText(e, players)}</span>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => run({ t: "host", op: "resolveCapture", captureId: String(e.payload.captureId), decision: "confirm" }).catch(() => {})}>
                        {t("live.host.confirmCapture")}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => run({ t: "host", op: "resolveCapture", captureId: String(e.payload.captureId), decision: "reject" }).catch(() => {})}>
                        {t("live.host.rejectCapture")}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </Sheet>

      <ConfirmDialog open={confirm === "emergency"} onOpenChange={(o) => !o && setConfirm(null)} title={t("live.emergency.title")} body={t("live.emergency.body")} confirmLabel={t("live.emergency.confirm")} destructive onConfirm={() => run({ t: "emergency" })} />
      <ConfirmDialog
        open={confirm === "leave"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={t("live.leave.title")}
        body={t("live.leave.body")}
        confirmLabel={t("live.leave.confirm")}
        destructive
        onConfirm={async () => {
          await run({ t: "withdraw" });
          router.push(`/groups/${view.groupId}`);
        }}
      />
      <ConfirmDialog open={confirm === "end"} onOpenChange={(o) => !o && setConfirm(null)} title={t("live.host.endTitle")} body={t("live.host.endBody")} confirmLabel={t("live.host.end")} destructive onConfirm={() => run({ t: "host", op: "end" })} />

      <RoleReveal key={view.reveal?.startsAt ?? 0} view={view} />
    </div>
  );
}
