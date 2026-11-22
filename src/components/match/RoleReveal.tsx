"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MatchView, Reveal } from "@/shared";
import { UserAvatar } from "@/components/common/UserAvatar";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { formatClock, useMediaQuery, useServerNow } from "@/lib/hooks";
import { serverNow } from "@/lib/time-sync";
import { cn } from "@/lib/utils";
import { vibrate } from "./TagFlows";

const EASE = "cubic-bezier(0.23, 1, 0.32, 1)";

/** Hop indices where the reticle locks a seeker (same formula as the server's script). */
export function landingIndices(r: Reveal): number[] {
  const n = r.hops.length;
  const k = r.seekerIds.length;
  return r.seekerIds.map((_, j) => Math.round(((j + 1) * n) / k) - 1);
}

/** Cumulative start of each hop (ms after startsAt) and the total. */
export function hopStarts(r: Reveal): { starts: number[]; total: number } {
  const starts: number[] = [];
  let acc = 0;
  for (const ms of r.hopMs) {
    starts.push(acc);
    acc += ms;
  }
  return { starts, total: acc };
}

/** Index of the hop showing at `elapsed` ms (-1 before the start). */
export function hopAt(starts: number[], elapsed: number): number {
  let k = -1;
  for (let i = 0; i < starts.length; i++) if (starts[i] <= elapsed) k = i;
  return k;
}

type Phase = "hops" | "card" | "done";
const seenKey = (v: MatchView) => `jh-reveal-${v.matchId}-${v.reveal?.startsAt ?? 0}`;
function wasSeen(v: MatchView) {
  try {
    return sessionStorage.getItem(seenKey(v)) === "1";
  } catch {
    return false;
  }
}

function RoleCard({ view, onDone, reduced }: { view: MatchView; onDone: () => void; reduced: boolean }) {
  const now = useServerNow(250);
  const el = useRef<HTMLDivElement>(null);
  const role = view.me?.role;
  const released = view.clock.activeStartedAt;
  const left = released !== undefined ? released - now : 0;
  useLayoutEffect(() => {
    // WAAPI so the crossfade still plays when the global reduced-motion CSS zeroes transitions.
    el.current?.animate(reduced ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: "scale(0.96)" }, { opacity: 1, transform: "scale(1)" }], { duration: reduced ? 300 : 240, easing: EASE });
  }, [reduced]);
  if (!role) return null;
  const seeker = role === "seeker";
  return (
    <div ref={el} className={cn("fixed inset-0 z-[60] flex flex-col items-center justify-center gap-6 px-6 pt-safe pb-safe text-center text-[oklch(0.17_0.02_40)]", seeker ? "bg-seeker" : "bg-hider")} role="dialog" aria-modal="true" aria-labelledby="role-card-title">
      <p className="text-sm font-semibold tracking-[0.2em] uppercase opacity-80">{t("reveal.youAre")}</p>
      <h2 id="role-card-title" className="text-6xl font-bold tracking-tight uppercase sm:text-7xl">
        {t(`roles.${role}`)}
      </h2>
      <p className="max-w-xs text-lg font-medium text-balance">{seeker ? t("reveal.goalSeeker") : t("reveal.goalHider")}</p>
      {left > 0 && (
        <div className="flex flex-col items-center gap-1">
          <span className="text-sm font-medium opacity-80">{seeker ? t("reveal.releasedIn") : t("reveal.seekersReleasedIn")}</span>
          <span className="font-mono text-5xl font-semibold tabular">{formatClock(left)}</span>
        </div>
      )}
      <Button size="lg" variant="outline" className="mt-4 min-w-40 border-current/40 bg-transparent text-current hover:bg-black/10" onClick={onDone} autoFocus>
        {t("reveal.gotIt")}
      </Button>
    </div>
  );
}

/**
 * "Target lock" role reveal (SPEC §8/§11): plays the server's script in sync on every phone, then my
 * role card. Transform/opacity only; DOM writes go through refs, not React renders, per hop.
 */
export function RoleReveal({ view }: { view: MatchView }) {
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const r = view.reveal;
  const { starts, total } = useMemo(() => (r ? hopStarts(r) : { starts: [], total: 0 }), [r]);
  const landings = useMemo(() => (r ? landingIndices(r) : []), [r]);
  const [phase, setPhase] = useState<Phase>(() => {
    if (!r || r.hops.length === 0) return "done";
    const now = serverNow();
    if (now < r.startsAt + total) return "hops";
    const late = view.state !== "countdown";
    return late && wasSeen(view) ? "done" : view.me?.role ? "card" : "done";
  });
  const reticle = useRef<HTMLDivElement>(null);
  const lens = useRef<HTMLDivElement>(null);
  const avatars = useRef(new Map<string, HTMLDivElement>());
  const ids = useMemo(() => {
    const order = view.players.map((p) => p.userId);
    return r ? order.filter((id) => r.hops.includes(id) || r.seekerIds.includes(id)) : order;
  }, [view.players, r]);
  const [radius] = useState(() => (typeof window === "undefined" ? 140 : Math.max(110, Math.min(220, Math.min(window.innerWidth, window.innerHeight) * 0.34))));
  const size = ids.length > 10 ? 44 : 56;
  const pos = (i: number) => {
    const a = (i / Math.max(1, ids.length)) * 2 * Math.PI - Math.PI / 2;
    return { x: Math.cos(a) * radius, y: Math.sin(a) * radius };
  };

  const finish = () => {
    try {
      sessionStorage.setItem(seenKey(view), "1");
    } catch {
      // storage blocked
    }
    setPhase("done");
  };

  // Hop driver: timers keyed to server time, so a late page jumps to the right hop.
  useEffect(() => {
    if (phase !== "hops" || !r) return;
    const lock = (id: string, animate: boolean) => {
      const a = avatars.current.get(id);
      if (!a || a.dataset.locked) return;
      a.dataset.locked = "1";
      if (!animate || reduced) return;
      lens.current?.animate([{ transform: "scale(1.4)" }, { transform: "scale(1)" }], { duration: 180, easing: EASE });
      const ripple = a.querySelector<HTMLElement>("[data-ripple]");
      ripple?.animate([{ opacity: 0.7, transform: "scale(1)" }, { opacity: 0, transform: "scale(2.2)" }], { duration: 450, easing: EASE });
    };
    if (reduced) {
      r.seekerIds.forEach((id) => lock(id, false));
      const id = setTimeout(() => setPhase("card"), Math.max(0, r.startsAt + total - serverNow()));
      return () => clearTimeout(id);
    }
    let shown = -1;
    let timer: ReturnType<typeof setTimeout>;
    let lockTimer: ReturnType<typeof setTimeout> | undefined;
    const move = (k: number, ms: number) => {
      const idx = ids.indexOf(r.hops[k]);
      const el = reticle.current;
      if (!el || idx < 0) return;
      const { x, y } = pos(idx);
      el.style.transition = ms > 0 ? `transform ${ms}ms ${EASE}` : "none";
      el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      el.style.opacity = "1";
    };
    const step = () => {
      const e = serverNow() - r.startsAt;
      if (e >= total) {
        setPhase(view.me?.role ? "card" : "done");
        return;
      }
      const k = hopAt(starts, e);
      if (k !== shown && k >= 0) {
        const jumped = shown === -1 ? k > 0 : k - shown > 1;
        // Seekers locked before a jump are shown locked without replaying.
        landings.forEach((li, j) => li < k && lock(r.seekerIds[j], false));
        const ms = jumped ? 0 : Math.max(60, Math.min(220, r.hopMs[k] * 0.55));
        move(k, ms);
        vibrate(8);
        const j = landings.indexOf(k);
        if (j >= 0) {
          clearTimeout(lockTimer);
          lockTimer = setTimeout(() => lock(r.seekerIds[j], true), ms);
        }
        shown = k;
      }
      const next = (k + 1 < starts.length ? starts[k + 1] : total) - e;
      timer = setTimeout(step, Math.max(16, next));
    };
    step();
    return () => {
      clearTimeout(timer);
      clearTimeout(lockTimer);
    };
    // pos/ids are stable for the overlay's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, r, reduced]);

  // Card: until the countdown ends, or briefly when the page loaded late.
  useEffect(() => {
    if (phase !== "card") return;
    const until = view.state === "countdown" && view.clock.countdownEndsAt ? Math.max(view.clock.countdownEndsAt, serverNow() + 2500) : serverNow() + 3500;
    const id = setTimeout(finish, until - serverNow());
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  if (phase === "done" || !r) return null;
  if (phase === "card") return <RoleCard view={view} onDone={finish} reduced={reduced} />;

  const players = new Map(view.players.map((p) => [p.userId, p]));
  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-10 bg-[oklch(0.13_0.01_260/0.94)] px-4 text-white" role="dialog" aria-modal="true" aria-label={t("reveal.title")}>
      <div className="flex flex-col items-center gap-1 text-center">
        <p className="text-xs font-semibold tracking-[0.25em] text-white/60 uppercase">{t("reveal.title")}</p>
        <p className="text-lg font-medium" aria-live="polite">
          {t("reveal.picking", { count: r.seekerIds.length })}
        </p>
      </div>
      <div className="relative" style={{ width: radius * 2 + size, height: radius * 2 + size }}>
        {ids.map((id, i) => {
          const p = players.get(id);
          const { x, y } = pos(i);
          return (
            <div
              key={id}
              ref={(node) => {
                if (node) avatars.current.set(id, node);
                else avatars.current.delete(id);
              }}
              className="group absolute start-1/2 top-1/2 flex flex-col items-center"
              style={{ transform: `translate(calc(${x}px - 50%), calc(${y}px - ${size / 2}px))` }}
            >
              <span className="relative rounded-full transition-[box-shadow,background-color] duration-150 group-data-[locked]:bg-seeker group-data-[locked]:shadow-[0_0_0_3px_var(--seeker),0_0_24px_var(--seeker)]" style={{ width: size, height: size }}>
                <UserAvatar avatar={p?.avatar} name={p?.name ?? "?"} className="size-full text-2xl" />
                <span data-ripple aria-hidden className="pointer-events-none absolute inset-0 rounded-full border-2 border-seeker opacity-0" />
              </span>
              <span className="mt-1 max-w-[5.5rem] truncate text-xs font-medium text-white/80 group-data-[locked]:text-seeker">{p?.name}</span>
            </div>
          );
        })}
        <div ref={reticle} aria-hidden className="pointer-events-none absolute start-1/2 top-1/2 opacity-0 will-change-transform" style={{ marginInlineStart: -(size + 20) / 2, marginTop: -(size + 20) / 2 }}>
          <div ref={lens} style={{ width: size + 20, height: size + 20 }}>
            <svg viewBox="0 0 100 100" className="size-full text-seeker" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round">
              <circle cx="50" cy="50" r="40" />
              <path d="M50 2v18M50 80v18M2 50h18M80 50h18" />
            </svg>
          </div>
        </div>
      </div>
      <span className="sr-only">{t("reveal.srSeekers", { names: r.seekerIds.map((id) => players.get(id)?.name ?? "").join(", ") })}</span>
    </div>
  );
}
