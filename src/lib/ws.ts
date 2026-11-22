"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ServerMessageSchema, type ClientMessage, type Issue, type MatchEvent, type MatchView, type ServerMessage } from "@/shared";
import { recordServerTime, serverNow } from "./time-sync";

export type ConnectionStatus = "connecting" | "open" | "reconnecting" | "offline";
export type MatchPrompt = Extract<ServerMessage, { t: "prompt" }>;
export type QrMessage = Extract<ServerMessage, { t: "qr" }>;
export type ServerError = Extract<ServerMessage, { t: "error" }>;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** Any client message; `opId` is added by `send` for the actions that carry one. */
export type Outgoing = DistributiveOmit<Exclude<ClientMessage, { t: "hello" }>, "opId">;

export interface AckResult {
  ok: boolean;
  /** Server error text, or `timeout` / `offline` from the client. */
  error?: string;
  /** i18n key for the error when the server provides one. */
  key?: string;
  /** Preflight problems on a failed start. */
  issues?: Issue[];
}

const OP_TYPES = new Set<ClientMessage["t"]>(["host", "emergency", "withdraw", "tag", "tagReply", "qrScan", "rescue", "rescueReply"]);
const ACK_TIMEOUT_MS = 8_000;
const HEARTBEAT_MS = 15_000;
const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 15_000;
const MAX_EVENTS = 500;
/** Close codes / error codes after which retrying cannot help (auth or membership). */
const FATAL_CLOSE = new Set([4401, 4403, 4404]);
const FATAL_ERRORS = new Set(["unauthorized", "forbidden", "not_member", "not_found"]);

export interface MatchSnapshot {
  status: ConnectionStatus;
  view: MatchView | null;
  events: MatchEvent[];
  prompt: MatchPrompt | null;
  qr: QrMessage | null;
  error: ServerError | null;
}

interface Pending {
  msg: ClientMessage;
  resolve: (r: AckResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

const wsUrl = () => `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws`;

/** Reconnecting socket for one match screen (SPEC §7). */
export class MatchSocket {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private everOpened = false;
  private stopped = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private hbTimer: ReturnType<typeof setInterval> | null = null;
  private hbSentAt = 0;
  private openedAt = 0;
  private lastSeq = 0;
  private pending = new Map<string, Pending>();
  snapshot: MatchSnapshot = { status: "connecting", view: null, events: [], prompt: null, qr: null, error: null };

  constructor(
    private readonly matchId: string,
    private readonly onChange: (s: MatchSnapshot) => void,
  ) {}

  start() {
    window.addEventListener("online", this.resume);
    window.addEventListener("offline", this.goOffline);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.connect();
  }

  stop() {
    this.stopped = true;
    window.removeEventListener("online", this.resume);
    window.removeEventListener("offline", this.goOffline);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.clearTimers();
    this.ws?.close(1000);
    this.ws = null;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.resolve({ ok: false, error: "offline" });
    }
    this.pending.clear();
  }

  send(msg: Outgoing): Promise<AckResult> {
    if (!OP_TYPES.has(msg.t)) {
      const ok = this.raw(msg as ClientMessage);
      return Promise.resolve(ok ? { ok: true } : { ok: false, error: "offline" });
    }
    const opId = crypto.randomUUID();
    const full = { ...msg, opId } as ClientMessage;
    return new Promise<AckResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(opId);
        resolve({ ok: false, error: "timeout" });
      }, ACK_TIMEOUT_MS);
      this.pending.set(opId, { msg: full, resolve, timer });
      // Not open: it goes out on reconnect (the server dedupes by opId).
      this.raw(full);
    });
  }

  clearPrompt() {
    this.update({ prompt: null });
  }

  private update(patch: Partial<MatchSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.onChange(this.snapshot);
  }

  private raw(msg: ClientMessage): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  private connect() {
    if (this.stopped) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      this.update({ status: "offline" });
      return;
    }
    this.update({ status: this.everOpened ? "reconnecting" : "connecting" });
    const ws = new WebSocket(wsUrl());
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.attempt = 0;
      this.everOpened = true;
      this.openedAt = Date.now();
      this.raw({ t: "hello", matchId: this.matchId, ...(this.lastSeq > 0 ? { lastSeq: this.lastSeq } : {}) });
      for (const p of this.pending.values()) this.raw(p.msg);
      this.hbTimer = setInterval(this.heartbeat, HEARTBEAT_MS);
      this.update({ status: "open", error: null });
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws || typeof ev.data !== "string") return;
      let data: unknown;
      try {
        data = JSON.parse(ev.data);
      } catch {
        return;
      }
      const parsed = ServerMessageSchema.safeParse(data);
      if (parsed.success) this.handle(parsed.data);
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.clearTimers();
      if (this.stopped) return;
      if (FATAL_CLOSE.has(ev.code)) {
        this.stopped = true;
        this.update({ status: "offline", error: this.snapshot.error ?? { t: "error", code: "closed", message: ev.reason || "closed" } });
        return;
      }
      this.scheduleRetry();
    };
    // onerror is always followed by onclose; nothing to do here.
    ws.onerror = () => {};
  }

  private handle(m: ServerMessage) {
    switch (m.t) {
      case "welcome":
        recordServerTime(m.serverNow, this.openedAt || Date.now());
        break;
      case "hbAck":
        if (this.hbSentAt) recordServerTime(m.serverNow, this.hbSentAt);
        break;
      case "view":
        this.update({ view: m.v });
        break;
      case "event": {
        if (m.e.seq <= this.lastSeq) break;
        this.lastSeq = m.e.seq;
        const events = [...this.snapshot.events, m.e];
        this.update({ events: events.length > MAX_EVENTS ? events.slice(-MAX_EVENTS) : events });
        break;
      }
      case "prompt":
        this.update({ prompt: m });
        break;
      case "qr":
        this.update({ qr: m });
        break;
      case "ack": {
        const p = this.pending.get(m.opId);
        if (!p) break;
        clearTimeout(p.timer);
        this.pending.delete(m.opId);
        p.resolve({ ok: m.ok, ...(m.error ? { error: m.error } : {}), ...(m.key ? { key: m.key } : {}), ...(m.issues ? { issues: m.issues } : {}) });
        break;
      }
      case "error":
        this.update({ error: m });
        if (FATAL_ERRORS.has(m.code)) {
          this.stopped = true;
          this.clearTimers();
          this.ws?.close(1000);
          this.update({ status: "offline" });
        }
        break;
    }
  }

  private heartbeat = () => {
    this.hbSentAt = Date.now();
    this.raw({ t: "hb" });
  };

  private scheduleRetry() {
    const base = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** this.attempt);
    const delay = base / 2 + Math.random() * (base / 2);
    this.attempt += 1;
    this.update({ status: navigator.onLine === false ? "offline" : "reconnecting" });
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }

  private clearTimers() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.hbTimer) clearInterval(this.hbTimer);
    this.retryTimer = null;
    this.hbTimer = null;
  }

  /** Back online or back in the foreground: reconnect now instead of waiting out the backoff. */
  private resume = () => {
    if (this.stopped) return;
    const state = this.ws?.readyState;
    if (state === WebSocket.OPEN) {
      this.heartbeat();
      return;
    }
    if (state === WebSocket.CONNECTING) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.attempt = 0;
    this.connect();
  };

  private goOffline = () => {
    if (!this.stopped) this.update({ status: "offline" });
  };

  private onVisibility = () => {
    if (document.visibilityState === "visible") this.resume();
  };
}

export interface UseMatch extends MatchSnapshot {
  send: (msg: Outgoing) => Promise<AckResult>;
  clearPrompt: () => void;
  serverNow: () => number;
}

/** Live match state over the reconnecting socket. `null` id = not connected. */
export function useMatch(matchId: string | null): UseMatch {
  const [snap, setSnap] = useState<MatchSnapshot>({ status: "connecting", view: null, events: [], prompt: null, qr: null, error: null });
  const sock = useRef<MatchSocket | null>(null);

  useEffect(() => {
    if (!matchId) return;
    const s = new MatchSocket(matchId, setSnap);
    sock.current = s;
    s.start();
    return () => {
      s.stop();
      if (sock.current === s) sock.current = null;
    };
  }, [matchId]);

  const send = useCallback((msg: Outgoing) => sock.current?.send(msg) ?? Promise.resolve<AckResult>({ ok: false, error: "offline" }), []);
  const clearPrompt = useCallback(() => sock.current?.clearPrompt(), []);
  return { ...snap, send, clearPrompt, serverNow };
}
