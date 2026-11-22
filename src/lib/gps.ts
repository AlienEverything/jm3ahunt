"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { classifyFreshness, distanceM, type LngLat } from "@/shared";

/** SPEC §10 sending rules. */
export const MIN_SEND_MS = 2_000;
export const RESEND_MS = 10_000;
export const MIN_MOVE_M = 5;

export type GpsState = "live" | "delayed" | "stale" | "off" | "denied" | "unavailable";

export interface GpsFix {
  lat: number;
  lng: number;
  acc: number;
  /** Client epoch ms of the reading. */
  ts: number;
  speed?: number;
  heading?: number;
}

export interface LocMessage extends GpsFix {
  t: "loc";
  sim?: boolean;
}

/**
 * Pure send rule: never more than every 2 s; otherwise send when moved ≥ 5 m or 10 s passed
 * since the last send. Exported for unit tests.
 */
export function shouldSend(fix: GpsFix, last: { fix: GpsFix; at: number } | null, now: number): boolean {
  if (!last) return true;
  const since = now - last.at;
  if (since < MIN_SEND_MS) return false;
  if (since >= RESEND_MS) return true;
  return distanceM([last.fix.lng, last.fix.lat], [fix.lng, fix.lat]) >= MIN_MOVE_M;
}

interface UseGpsOptions {
  /** `view.me.tracking`: false stops the watch immediately (withdraw, emergency, consent loss, match end). */
  tracking: boolean;
  send: (msg: LocMessage) => void;
  staleAfterSec: number;
  /** Simulation match: no real GPS; `simPosition` (tapped on the map) is sent instead with `sim: true`. */
  simulation?: boolean;
  simPosition?: LngLat | null;
  /** Called when the page returns to the foreground while tracking. */
  onResume?: () => void;
}

/**
 * Foreground GPS for a live match. No background tracking: browsers pause it when the tab is hidden,
 * so on return we tell the player and resend at once.
 */
export function useGps({ tracking, send, staleAfterSec, simulation = false, simPosition = null, onResume }: UseGpsOptions) {
  const [fix, setFix] = useState<GpsFix | null>(null);
  const [error, setError] = useState<"denied" | "unavailable" | null>(null);
  const last = useRef<{ fix: GpsFix; at: number } | null>(null);
  const latest = useRef<GpsFix | null>(null);
  const sendRef = useRef(send);
  const resumeRef = useRef(onResume);
  useEffect(() => {
    sendRef.current = send;
    resumeRef.current = onResume;
  });
  // Local clock (fix.ts is a client timestamp), ticking so freshness ages.
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const push = useCallback(
    (f: GpsFix, force = false) => {
      latest.current = f;
      const at = Date.now();
      if (force ? last.current !== null && at - last.current.at < MIN_SEND_MS : !shouldSend(f, last.current, at)) return;
      last.current = { fix: f, at };
      sendRef.current({ t: "loc", lat: f.lat, lng: f.lng, acc: f.acc, ts: f.ts, ...(f.speed != null ? { speed: f.speed } : {}), ...(f.heading != null ? { heading: f.heading } : {}), ...(simulation ? { sim: true } : {}) });
    },
    [simulation],
  );

  // Real GPS.
  useEffect(() => {
    if (!tracking || simulation) return;
    if (typeof navigator === "undefined" || !("geolocation" in navigator) || !window.isSecureContext) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reflects a platform capability once
      setError("unavailable");
      return;
    }
    const onPos = (p: GeolocationPosition) => {
      setError(null);
      const f: GpsFix = {
        lat: p.coords.latitude,
        lng: p.coords.longitude,
        acc: p.coords.accuracy,
        ts: p.timestamp || Date.now(),
        ...(p.coords.speed != null && Number.isFinite(p.coords.speed) ? { speed: Math.max(0, p.coords.speed) } : {}),
        ...(p.coords.heading != null && Number.isFinite(p.coords.heading) ? { heading: p.coords.heading } : {}),
      };
      setFix(f);
      push(f);
    };
    const onErr = (e: GeolocationPositionError) => setError(e.code === e.PERMISSION_DENIED ? "denied" : "unavailable");
    const opts: PositionOptions = { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 };
    const id = navigator.geolocation.watchPosition(onPos, onErr, opts);
    // A phone standing still may not report new positions; ask for a fresh reading every 10 s.
    const poll = setInterval(() => {
      const l = latest.current;
      if (!l || Date.now() - l.ts >= RESEND_MS) navigator.geolocation.getCurrentPosition(onPos, onErr, opts);
      else if (l) push(l); // a reading held back by the 2 s limit goes out now
    }, MIN_SEND_MS);
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      resumeRef.current?.();
      navigator.geolocation.getCurrentPosition((p) => {
        onPos(p);
        if (latest.current) push(latest.current, true);
      }, onErr, opts);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      navigator.geolocation.clearWatch(id);
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [tracking, simulation, push]);

  // Simulated GPS: the tapped position, re-sent every 10 s so it stays fresh.
  useEffect(() => {
    if (!tracking || !simulation || !simPosition) return;
    const make = (): GpsFix => ({ lng: simPosition[0], lat: simPosition[1], acc: 5, ts: Date.now() });
    const first = make();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mirrors the tapped position
    setFix(first);
    last.current = null; // a new tap always goes out (subject to the server's 2 s limit)
    push(first);
    const id = setInterval(() => {
      const f = make();
      setFix(f);
      push(f);
    }, RESEND_MS);
    return () => clearInterval(id);
  }, [tracking, simulation, simPosition, push]);

  // Stop: forget everything as soon as tracking ends.
  useEffect(() => {
    if (tracking) return;
    last.current = null;
    latest.current = null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing local state when sharing stops
    setFix(null);
    setError(null);
  }, [tracking]);

  let state: GpsState;
  if (!tracking) state = "off";
  else if (error && !simulation) state = error;
  else state = classifyFreshness(fix?.ts ?? null, clock, staleAfterSec);

  return { fix: tracking ? fix : null, state };
}

/** Optional "Keep screen awake" (Screen Wake Lock API), re-acquired when the page is visible again. */
export function useWakeLock(enabled: boolean) {
  const supported = typeof navigator !== "undefined" && "wakeLock" in navigator;
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (!enabled || !supported) return;
    let lock: WakeLockSentinel | null = null;
    let live = true;
    const acquire = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        lock = await navigator.wakeLock.request("screen");
        if (!live) {
          void lock.release();
          return;
        }
        setActive(true);
        lock.addEventListener("release", () => live && setActive(false));
      } catch {
        setActive(false);
      }
    };
    void acquire();
    const onVis = () => void acquire();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      live = false;
      document.removeEventListener("visibilitychange", onVis);
      void lock?.release();
      setActive(false);
    };
  }, [enabled, supported]);
  return { supported, active };
}
