// Authoritative in-memory state of one match (SPEC §8). Rules come from src/shared; this file wires
// them to time, sockets and the DB. Locations live only in `live` and `pings` and leave this process
// exclusively through buildView().
import { nanoid } from "nanoid";
import {
  INITIAL_BOUNDARY,
  IllegalTransitionError,
  TRACKING_STATES,
  accrueSurvival,
  applyOutcome,
  applyRescue,
  assertTransition,
  assignRoles,
  buildResult,
  buildRevealScript,
  buildView,
  canCapture,
  canRescue,
  checkJump,
  classifyBoundary,
  classifyInZone,
  classifyPresence,
  computeScores,
  cryptoRng,
  destination,
  dueTransition,
  effectiveSignedDistanceM,
  elapsedActiveMs,
  emptyStats,
  evaluateVictory,
  eventVisibleTo,
  findMainZone,
  inFinalReveal,
  inscribedRadiusAt,
  isFresh,
  isPausable,
  isTerminal,
  makeGridOffset,
  pauseClock,
  pingCountAt,
  proximityHint,
  recordCapture,
  recordRescue,
  releaseIfDue,
  resumeClock,
  shapeCenter,
  shiftBoundary,
  shiftPlayerTimers,
  startClock,
  stepBoundary,
  takePingSnapshot,
  timelineMarks,
  validateSettings,
  zoneStateAt,
  type Avatar,
  type BoundaryPenalty,
  type BoundaryState,
  type CapturePlayer,
  type ClientMessage,
  type EventAudience,
  type EventPayloadValue,
  type GameMode,
  type GridOffset,
  type HostOp,
  type Issue,
  type LngLat,
  type LocationFix,
  type MatchClock,
  type MatchEvent,
  type MatchEventType,
  type MatchResult,
  type MatchState,
  type PingReason,
  type PingSnapshot,
  type PlayerStats,
  type PlayerStatus,
  type Presence,
  type Reveal,
  type Role,
  type ServerMessage,
  type Settings,
  type ViewInput,
  type ViewPlayerInput,
  type Winner,
  type VictoryReason,
  type Zone,
} from "@/shared";
import type { RateLimiter } from "../security/rateLimit";
import { issueTagToken, verifyTagToken } from "../security/tagToken";
import type { MatchRow, PlayerRow, Store } from "./store";

export const VIEW_THROTTLE_MS = 1500;
export const MIN_FIX_INTERVAL_MS = 2000;
export const SNAPSHOT_EVERY_MS = 15_000;
const EVENT_BUFFER = 500;
const MISSED_EVENTS_CAP = 200;
const OP_CACHE = 200;
const RESCUE_PROMPT_MS = 60_000;
const BOT_FIX_EVERY_MS = 3000;
const BOT_REPLY_MS = 2000;

export interface RuntimeDeps {
  now: () => number;
  store: Store;
  tagSecret: string;
  /** ALLOW_SIM_GPS and not production. */
  allowSim: boolean;
  captureLimiter: RateLimiter;
}

/** One subscribed socket. */
export interface RtClient {
  userId: string;
  name: string;
  avatar: Avatar;
  /** Group owner/admin (from DB at hello). */
  canManage: boolean;
  send(msg: ServerMessage): void;
  lastViewAt: number;
  dirty: boolean;
}

interface RtPlayer {
  userId: string;
  name: string;
  avatar: Avatar;
  role: Role | null;
  team: string | null;
  status: PlayerStatus;
  ready: boolean;
  consentHash: string | null;
  joinedAt: number;
  leftAt?: number;
  isBot: boolean;
  boundary: BoundaryState;
  freezeEndsAt?: number;
  jailEndsAt?: number;
  rescuesDone: number;
  lastRescueAt?: number;
  sockets: number;
  disconnectedAt?: number;
  /** Server receive time of the last accepted fix. */
  lastFixAt?: number;
  /** Server receive time of the last fix that passed the rate limit. */
  lastRxAt?: number;
  suspect: LocationFix | null;
  presence: Presence;
  botPos?: LngLat;
  botHeading?: number;
  botNextFixAt?: number;
}

interface CaptureRec {
  id: string;
  seekerId: string;
  hiderId: string;
  method: "mutual" | "qr" | "code";
  status: "pending" | "confirmed" | "disputed" | "rejected" | "expired";
  createdAt: number;
  expiresAt: number;
  botAcceptAt?: number;
  /** Proximity hint at tag time. Shown to the hider (prompt) and on disputes, never in the seeker's ack. */
  hint?: "far";
}

interface PendingRescue {
  rescuerId: string;
  expiresAt: number;
  botAcceptAt?: number;
}

interface Snapshot {
  clock: MatchClock;
  reveal?: Reveal;
  grid?: GridOffset;
  pingsDone: number;
  marksDone: number;
  overtimeNotified: boolean;
  finalRevealOn: boolean;
  lastAccrueAt?: number;
  stats: Record<string, PlayerStats>;
  kicked: string[];
  players: Record<string, Pick<RtPlayer, "boundary" | "freezeEndsAt" | "jailEndsAt" | "rescuesDone" | "lastRescueAt">>;
  captures: CaptureRec[];
}

type AckResult = { ok: true; key?: string } | { ok: false; error: string; key?: string; issues?: Issue[] };
type AckMsg = Extract<ServerMessage, { t: "ack" }>;
const fail = (error: string, key?: string, issues?: Issue[]): AckResult => ({ ok: false, error, ...(key ? { key } : {}), ...(issues ? { issues } : {}) });
const OK: AckResult = { ok: true };

export type LoadedMatch = NonNullable<Awaited<ReturnType<Store["loadMatch"]>>>;

export class MatchRuntime {
  readonly id: string;
  readonly groupId: string;
  readonly mode: GameMode;
  readonly createdAt: number;
  name: string;
  state: MatchState;
  hostId: string;
  settings: Settings;
  zones: Zone[];
  settingsHash: string;
  version: number;
  startedAt: number | null;
  endedAt: number | null;
  result?: MatchResult;

  clock: MatchClock = { pausedTotalMs: 0, activePausedMs: 0 };
  reveal?: Reveal;
  private grid?: GridOffset;
  private pingsDone = 0;
  private marksDone = 0;
  private overtimeNotified = false;
  private finalRevealOn = false;
  private lastAccrueAt?: number;
  private stats: Record<string, PlayerStats> = {};
  readonly players = new Map<string, RtPlayer>();
  /** Latest accepted fix per player. Memory only. */
  private live = new Map<string, LocationFix>();
  private pings: PingSnapshot[] = [];
  private captures = new Map<string, CaptureRec>();
  private rescues = new Map<string, PendingRescue>();
  private kicked = new Set<string>();
  private events: MatchEvent[] = [];
  private seq = 0;
  readonly clients = new Set<RtClient>();
  private ops = new Map<string, Map<string, AckMsg>>();
  private lastSnapshotAt = 0;
  private urgent = false;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    loaded: LoadedMatch,
    private deps: RuntimeDeps,
  ) {
    const m = loaded.match;
    this.id = m.id;
    this.groupId = m.groupId;
    this.mode = m.mode;
    this.createdAt = m.createdAt;
    this.name = m.name;
    this.state = m.state;
    this.hostId = m.hostId;
    this.settings = m.settings;
    this.zones = m.zones;
    this.settingsHash = m.settingsHash;
    this.version = m.version;
    this.startedAt = m.startedAt;
    this.endedAt = m.endedAt;
    if (m.result) this.result = m.result;

    const snap = (m.snapshot ?? null) as Snapshot | null;
    const now = deps.now();
    for (const { p, name, color, emoji } of loaded.players) {
      const s = snap?.players[p.userId];
      this.players.set(p.userId, {
        userId: p.userId,
        name,
        avatar: { color, emoji },
        role: p.role,
        team: p.team,
        status: p.status,
        ready: p.ready,
        consentHash: p.consentHash,
        joinedAt: p.joinedAt,
        ...(p.leftAt != null ? { leftAt: p.leftAt } : {}),
        isBot: p.isBot,
        boundary: s?.boundary ?? INITIAL_BOUNDARY,
        ...(s?.freezeEndsAt !== undefined ? { freezeEndsAt: s.freezeEndsAt } : {}),
        ...(s?.jailEndsAt !== undefined ? { jailEndsAt: s.jailEndsAt } : {}),
        rescuesDone: s?.rescuesDone ?? 0,
        ...(s?.lastRescueAt !== undefined ? { lastRescueAt: s.lastRescueAt } : {}),
        sockets: 0,
        // Everyone was disconnected by the restart: give them the normal offline grace.
        disconnectedAt: now,
        suspect: null,
        presence: "stale",
      });
    }
    if (snap) {
      this.clock = snap.clock;
      if (snap.reveal) this.reveal = snap.reveal;
      if (snap.grid) this.grid = snap.grid;
      this.pingsDone = snap.pingsDone;
      this.marksDone = snap.marksDone;
      this.overtimeNotified = snap.overtimeNotified;
      this.finalRevealOn = snap.finalRevealOn;
      if (snap.lastAccrueAt !== undefined) this.lastAccrueAt = snap.lastAccrueAt;
      this.stats = snap.stats;
      this.kicked = new Set(snap.kicked);
      for (const c of snap.captures) this.captures.set(c.id, c);
    }
    for (const e of loaded.events) {
      this.events.push({ seq: e.seq, type: e.type as MatchEventType, at: e.createdAt, actorId: e.actorId, payload: e.payload as MatchEvent["payload"], audience: e.audience as EventAudience });
      this.seq = Math.max(this.seq, e.seq);
    }
    if (this.state === "preflight") {
      // Crashed mid-preflight: nothing was locked yet.
      this.state = "lobby";
      this.persist();
    }
    this.lastSnapshotAt = now;
  }

  // ── public surface ────────────────────────────────────────────────────────

  get now() {
    return this.deps.now();
  }

  /** Resolves when every queued DB write so far has finished. */
  flushWrites(): Promise<void> {
    return this.chain;
  }

  activePlayers() {
    return [...this.players.values()].filter((p) => p.status !== "withdrawn");
  }

  isHost(client: Pick<RtClient, "userId" | "canManage">) {
    return client.userId === this.hostId || client.canManage;
  }

  attach(client: RtClient, lastSeq?: number) {
    let p = this.players.get(client.userId);
    let joinError: string | null = null;
    if (!p && (this.state === "lobby" || this.state === "draft") && !this.kicked.has(client.userId)) {
      if (this.activePlayers().length >= this.settings.general.maxPlayers) joinError = "match_full";
      else p = this.addPlayer(client.userId, client.name, client.avatar, false);
    }
    if (p) {
      p.name = client.name;
      p.avatar = client.avatar;
      if (p.sockets === 0 && p.disconnectedAt !== undefined && TRACKING_STATES.includes(this.state)) {
        this.emit("player.rejoined", { userId: p.userId }, "all", p.userId);
      }
      p.sockets++;
      delete p.disconnectedAt;
    }
    this.clients.add(client);
    client.lastViewAt = 0;
    this.mark(true);
    this.flush();

    if (lastSeq !== undefined) {
      const role = this.players.get(client.userId)?.role ?? null;
      const missed = this.events.filter((e) => e.seq > lastSeq && eventVisibleTo(e, { userId: client.userId, role })).slice(-MISSED_EVENTS_CAP);
      for (const e of missed) client.send({ t: "event", e });
    }
    for (const c of this.captures.values()) {
      if (c.status === "pending" && c.hiderId === client.userId) client.send(this.tagPrompt(c));
    }
    const r = this.rescues.get(client.userId);
    if (r) client.send(this.rescuePrompt(r));
    if (joinError) client.send({ t: "error", code: joinError, message: "The match is full" });
  }

  detach(client: RtClient) {
    if (!this.clients.delete(client)) return;
    const p = this.players.get(client.userId);
    if (p) {
      p.sockets = Math.max(0, p.sockets - 1);
      if (p.sockets === 0) p.disconnectedAt = this.now;
    }
    this.mark(false);
    this.flush();
  }

  /** Dispatch one validated client message (hello / hb are handled by the gateway). */
  handle(client: RtClient, msg: ClientMessage) {
    try {
      this.dispatch(client, msg);
    } finally {
      this.flush();
    }
  }

  /** REST settings/zones change. Returns an error code or null. */
  updateConfig(settings: Settings, zones: Zone[], hash: string): string | null {
    if (this.state !== "draft" && this.state !== "lobby") return "locked";
    this.settings = settings;
    this.zones = zones;
    this.settingsHash = hash;
    this.version++;
    for (const p of this.players.values()) {
      p.ready = p.isBot;
      p.consentHash = p.isBot ? hash : null;
    }
    this.emit("settings.changed", { version: this.version });
    this.persist();
    this.mark(true);
    this.flush();
    return null;
  }

  /** Called every second by the scheduler (tests call it directly with an injected clock). */
  tick() {
    const now = this.now;
    if (!isTerminal(this.state)) {
      this.runTimers(now);
      this.updatePresence(now);
      this.runBots(now);
      if (!isTerminal(this.state) && now - this.lastSnapshotAt >= SNAPSHOT_EVERY_MS) this.persist();
    }
    this.flush();
  }

  /** Snapshot now (shutdown / tests). */
  persistNow() {
    this.persist();
    return this.flushWrites();
  }

  // ── dispatch ──────────────────────────────────────────────────────────────

  private dispatch(client: RtClient, msg: ClientMessage) {
    const p = this.players.get(client.userId);
    switch (msg.t) {
      case "loc": {
        if (!p) return this.sendError(client, "not_player");
        const err = this.ingestFix(p, { lat: msg.lat, lng: msg.lng, acc: msg.acc, ts: msg.ts, ...(msg.speed != null ? { speed: msg.speed } : {}), ...(msg.heading != null ? { heading: msg.heading } : {}) }, msg.sim === true);
        if (err) this.sendError(client, err);
        return;
      }
      case "consent":
        if (!p) return this.sendError(client, "not_player");
        if (msg.accept) {
          if (msg.settingsHash !== this.settingsHash) return this.sendError(client, "stale_settings");
          if (p.status === "withdrawn" || isTerminal(this.state)) return this.sendError(client, "not_allowed");
          p.consentHash = this.settingsHash;
        } else {
          this.dropLocation(p);
          p.consentHash = null;
          p.ready = false;
        }
        this.emit("player.consented", { userId: p.userId, accepted: msg.accept }, "all", p.userId);
        this.persist();
        return this.mark(true);
      case "ready":
        if (!p) return this.sendError(client, "not_player");
        if (this.state !== "lobby" && this.state !== "draft") return this.sendError(client, "wrong_state");
        if (msg.ready && p.consentHash !== this.settingsHash) return this.sendError(client, "consent_required");
        p.ready = msg.ready;
        this.emit("player.ready", { userId: p.userId, ready: msg.ready }, "all", p.userId);
        this.persist();
        return this.mark(true);
      case "host":
        return this.op(client, msg.opId, () => this.hostOp(client, msg));
      case "emergency":
        return this.op(client, msg.opId, () => this.emergency(client));
      case "withdraw":
        return this.op(client, msg.opId, () => this.withdraw(client.userId));
      case "tag":
        return this.op(client, msg.opId, () => this.tag(client.userId, msg.hiderId));
      case "tagReply":
        return this.op(client, msg.opId, () => this.tagReply(client.userId, msg.captureId, msg.accept));
      case "qrToken": {
        if (!p || p.role !== "hider" || !TRACKING_STATES.includes(this.state) || p.status === "withdrawn" || p.status === "eliminated") {
          return this.sendError(client, "not_allowed");
        }
        const t = issueTagToken(this.deps.tagSecret, this.id, p.userId, this.now);
        return client.send({ t: "qr", ...t });
      }
      case "qrScan":
        return this.op(client, msg.opId, () => this.qrScan(client.userId, msg.token));
      case "rescue":
        return this.op(client, msg.opId, () => this.rescue(client.userId, msg.jailedId));
      case "rescueReply":
        return this.op(client, msg.opId, () => this.rescueReply(client.userId, msg.rescuerId, msg.accept));
      case "hello":
      case "hb":
        return;
    }
  }

  /** Idempotent action: a repeated opId gets the stored ack without re-applying. */
  private op(client: RtClient, opId: string, fn: () => AckResult) {
    let cache = this.ops.get(client.userId);
    if (!cache) this.ops.set(client.userId, (cache = new Map()));
    const prev = cache.get(opId);
    if (prev) return client.send(prev);
    let r: AckResult;
    try {
      r = fn();
    } catch (err) {
      if (!(err instanceof IllegalTransitionError)) throw err;
      r = fail("wrong_state");
    }
    const ack: AckMsg = { t: "ack", opId, ...r };
    if (r.ok || r.error !== "rate_limited") {
      cache.set(opId, ack);
      if (cache.size > OP_CACHE) cache.delete(cache.keys().next().value as string);
    }
    client.send(ack);
  }

  private hostOp(client: RtClient, msg: HostOp): AckResult {
    if (!this.isHost(client)) return fail("forbidden", "errors.notHost");
    const now = this.now;
    switch (msg.op) {
      case "open":
        if (this.state !== "draft") return fail("wrong_state");
        this.transition("lobby");
        this.emit("match.opened", {}, "all", client.userId);
        return OK;
      case "start":
        return this.start(client.userId, now);
      case "pause":
        if (!isPausable(this.state)) return fail("wrong_state");
        this.pause(now, client.userId, false);
        return OK;
      case "resume":
        return this.resume(now, client.userId);
      case "end":
        if (isTerminal(this.state)) return fail("wrong_state");
        this.finish({ winner: "draw", reason: "cancelled" }, now);
        return OK;
      case "assignRoles":
      case "setRole": {
        if (this.settings.roles.assignment !== "manual") return fail("not_manual");
        if (this.state !== "lobby" && this.state !== "draft") return fail("wrong_state");
        if (msg.op === "setRole") {
          const t = this.players.get(msg.userId);
          if (!t) return fail("not_found");
          t.role = msg.role;
          t.team = msg.role;
        } else {
          const ids = [...this.players.keys()];
          if (ids.length < 2) return fail("not_enough_players");
          const { seekers } = assignRoles(ids, this.settings.roles.seekerCount, cryptoRng);
          for (const p of this.players.values()) {
            p.role = seekers.includes(p.userId) ? "seeker" : "hider";
            p.team = p.role;
          }
        }
        this.emit("roles.assigned", { seekerIds: this.idsWithRole("seeker") }, "all", client.userId);
        this.persist();
        this.mark(true);
        return OK;
      }
      case "kick": {
        const t = this.players.get(msg.userId);
        if (!t || msg.userId === client.userId) return fail("not_found");
        this.kicked.add(msg.userId);
        this.emit("player.kicked", { userId: msg.userId }, "all", client.userId);
        this.removeOrWithdraw(t, now);
        return OK;
      }
      case "resolveCapture": {
        const c = this.captures.get(msg.captureId);
        if (!c || (c.status !== "pending" && c.status !== "disputed")) return fail("not_found");
        if (msg.decision === "confirm") this.confirmCapture(c, client.userId, now);
        else {
          this.setCaptureStatus(c, "rejected", client.userId, now);
          this.emit("capture.resolved", { captureId: c.id, seekerId: c.seekerId, hiderId: c.hiderId, decision: "reject" }, "all", client.userId);
        }
        this.mark(true);
        return OK;
      }
      case "addBot": {
        if (!this.settings.simulation || !this.deps.allowSim) return fail("simulation_only");
        if (this.state !== "lobby" && this.state !== "draft") return fail("wrong_state");
        const n = msg.count ?? 1;
        if (this.activePlayers().length + n > this.settings.general.maxPlayers) return fail("match_full");
        for (let i = 0; i < n; i++) {
          const id = `bot_${nanoid(12)}`;
          const name = `Bot ${[...this.players.values()].filter((x) => x.isBot).length + 1}`;
          this.q(() => this.deps.store.insertBotUser(id, name, now));
          this.addPlayer(id, name, { color: "#6B7280", emoji: "🤖" }, true);
        }
        return OK;
      }
      case "removeBot": {
        const t = this.players.get(msg.userId);
        if (!t?.isBot) return fail("not_found");
        this.removeOrWithdraw(t, now);
        return OK;
      }
    }
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────

  private transition(to: MatchState) {
    assertTransition(this.state, to, this.clock.pausedFrom ? { pausedFrom: this.clock.pausedFrom } : {});
    this.state = to;
    this.version++;
    this.persist();
    this.mark(true);
  }

  private preflightIssues(): Issue[] {
    const players = [...this.players.values()];
    const issues = validateSettings(this.settings, { zones: this.zones, playerCount: players.length, allowSimulation: this.deps.allowSim }).filter((i) => i.severity === "error");
    const notReady = players.filter((p) => !p.ready || p.consentHash !== this.settingsHash).length;
    if (notReady > 0) issues.push({ path: "players", severity: "error", key: "issues.start.notReady", params: { count: notReady } });
    if (this.settings.roles.assignment === "manual") {
      const roles = new Set(players.map((p) => p.role));
      if (players.some((p) => !p.role) || !roles.has("seeker") || !roles.has("hider")) {
        issues.push({ path: "roles", severity: "error", key: "issues.start.rolesIncomplete" });
      }
    }
    return issues;
  }

  private start(actorId: string, now: number): AckResult {
    if (this.state !== "lobby") return fail("wrong_state");
    this.transition("preflight");
    const issues = this.preflightIssues();
    if (issues.length > 0) {
      this.transition("lobby");
      return fail("preflight_failed", issues[0].key, issues);
    }
    const players = [...this.players.values()];
    if (this.settings.roles.assignment === "random") {
      // Roles are drawn here, at start, never earlier.
      const { seekers } = assignRoles(players.map((p) => p.userId), this.settings.roles.seekerCount, cryptoRng);
      for (const p of players) p.role = seekers.includes(p.userId) ? "seeker" : "hider";
    }
    for (const p of players) {
      p.team = p.role;
      p.status = "free";
      p.boundary = INITIAL_BOUNDARY;
      p.rescuesDone = 0;
      delete p.freezeEndsAt;
      delete p.jailEndsAt;
      this.stats[p.userId] = emptyStats();
    }
    const seekerIds = this.idsWithRole("seeker");
    this.clock = startClock(now, this.settings);
    this.reveal = buildRevealScript(players.map((p) => p.userId), seekerIds, now, cryptoRng);
    const main = findMainZone(this.zones);
    this.grid = makeGridOffset(main ? shapeCenter(main.shape)[1] : 0, cryptoRng);
    this.pingsDone = 0;
    this.marksDone = 0;
    this.startedAt = now;
    this.transition("countdown");
    this.emit("match.started", {}, "all", actorId);
    this.emit("roles.assigned", { seekerIds }, "all", null);
    this.emit("match.countdown", { endsAt: this.clock.countdownEndsAt ?? now }, "all", null);
    return OK;
  }

  private pause(now: number, actorId: string, emergency: boolean) {
    if (!isPausable(this.state)) return;
    this.accrue(now);
    this.clock = pauseClock(this.clock, now, this.state);
    this.transition("paused");
    this.emit(emergency ? "match.emergency" : "match.paused", { userId: actorId }, "all", actorId);
  }

  private resume(now: number, actorId: string): AckResult {
    if (this.state !== "paused") return fail("wrong_state");
    const pausedFrom = this.clock.pausedFrom;
    const { clock, shiftMs, resumeTo } = resumeClock(this.clock, now);
    const to = resumeTo ?? pausedFrom ?? "active";
    assertTransition("paused", to, { pausedFrom: to });
    this.clock = clock;
    for (const p of this.players.values()) {
      Object.assign(p, shiftPlayerTimers(this.cp(p), shiftMs));
      p.boundary = shiftBoundary(p.boundary, shiftMs);
    }
    for (const c of this.captures.values()) {
      c.expiresAt += shiftMs;
      if (c.botAcceptAt !== undefined) c.botAcceptAt += shiftMs;
    }
    for (const r of this.rescues.values()) {
      r.expiresAt += shiftMs;
      if (r.botAcceptAt !== undefined) r.botAcceptAt += shiftMs;
    }
    this.state = to;
    this.version++;
    if (to === "active") this.lastAccrueAt = now;
    this.persist();
    this.mark(true);
    this.emit("match.resumed", { userId: actorId }, "all", actorId);
    return OK;
  }

  private finish(v: { winner: Winner; reason: VictoryReason; scores?: ReturnType<typeof computeScores> }, now: number) {
    this.accrue(now);
    const stats = Object.fromEntries(Object.entries(this.stats).map(([id, s]) => [id, { ...s, survivedSec: Math.floor(s.survivedSec) }]));
    this.result = buildResult({ status: "decided", ...v }, now, stats);
    this.endedAt = now;
    for (const c of this.captures.values()) if (c.status === "pending") this.setCaptureStatus(c, "expired", null, now);
    this.live.clear();
    this.pings = [];
    this.rescues.clear();
    this.transition("finished");
    this.emit("match.finished", { winner: v.winner, reason: v.reason }, "all", null);
    if (v.reason !== "cancelled") {
      const result = this.result;
      const roles = Object.fromEntries([...this.players.values()].map((p) => [p.userId, p.role]));
      const bots = new Set([...this.players.values()].filter((p) => p.isBot).map((p) => p.userId));
      this.q(() => this.deps.store.addUserStats(result, roles, bots));
    }
  }

  private checkVictory(now: number) {
    if (this.state !== "active") return;
    const v = evaluateVictory({
      state: this.state,
      now,
      clock: this.clock,
      settings: this.settings,
      players: [...this.players.values()].map((p) => this.cp(p)),
      pendingCaptures: [...this.captures.values()].filter((c) => c.status === "pending").length,
      stats: this.stats,
    });
    if (v.status === "decided") this.finish(v, now);
    else if (v.status === "overtime" && !this.overtimeNotified) {
      this.overtimeNotified = true;
      this.emit("match.overtime", { until: v.until }, "all", null);
      this.mark(true);
    }
  }

  private runTimers(now: number) {
    for (let guard = 0; guard < 3; guard++) {
      const due = dueTransition(this.state, this.clock, now);
      if (!due) break;
      this.transition(due);
      if (due === "hiding") this.emit("match.hiding", { endsAt: this.clock.hidingEndsAt ?? now }, "all", null);
      if (due === "active") {
        this.lastAccrueAt = now;
        this.emit("match.active", { endsAt: this.clock.endsAt ?? now }, "all", null);
      }
    }
    if (this.state !== "active") return;

    this.accrue(now);
    const elapsed = elapsedActiveMs(this.clock, now);
    const main = findMainZone(this.zones);
    if (main) {
      const marks = timelineMarks(main);
      while (this.marksDone < marks.length && marks[this.marksDone].atMs <= elapsed) {
        const m = marks[this.marksDone++];
        this.emit(`zone.${m.type}`, { zoneId: main.id, phaseIndex: m.phaseIndex, phaseCount: zoneStateAt(main, elapsed).phaseCount }, "all", null);
        this.mark(true);
      }
    }
    const duePings = pingCountAt(this.settings, elapsed);
    if (duePings > this.pingsDone) {
      this.pingsDone = duePings;
      this.takePings("scheduled", now);
    }
    const reveal = inFinalReveal(this.state, this.clock, this.settings, now);
    if (reveal !== this.finalRevealOn) {
      this.finalRevealOn = reveal;
      this.mark(true);
    }

    for (const p of this.players.values()) {
      const r = releaseIfDue(this.cp(p), now);
      if (!r) continue;
      this.setCp(p, r);
      this.emit("player.released", { userId: p.userId }, "all", null);
      this.mark(true);
    }
    for (const c of this.captures.values()) {
      if (c.status !== "pending") continue;
      if (c.botAcceptAt !== undefined && now >= c.botAcceptAt) this.confirmCapture(c, c.hiderId, now);
      else if (now >= c.expiresAt) {
        this.setCaptureStatus(c, "expired", null, now);
        this.emit("capture.expired", { captureId: c.id, seekerId: c.seekerId, hiderId: c.hiderId }, "all", null);
        this.mark(true);
      }
      if (this.state !== "active") return;
    }
    for (const [jailedId, r] of this.rescues) {
      if (r.botAcceptAt !== undefined && now >= r.botAcceptAt) this.rescueReply(jailedId, r.rescuerId, true);
      else if (now >= r.expiresAt) this.rescues.delete(jailedId);
    }
    this.checkVictory(now);
  }

  private accrue(now: number) {
    if (this.state !== "active" || this.lastAccrueAt === undefined) return;
    const dt = Math.max(0, now - this.lastAccrueAt) / 1000;
    this.lastAccrueAt = now;
    if (dt > 0) this.stats = accrueSurvival(this.stats, [...this.players.values()].map((p) => this.cp(p)), dt);
  }

  private updatePresence(now: number) {
    const tracking = TRACKING_STATES.includes(this.state);
    for (const p of this.players.values()) {
      const presence: Presence = p.isBot
        ? "online"
        : classifyPresence(
            {
              socketOpen: p.sockets > 0,
              ...(p.disconnectedAt !== undefined ? { disconnectedAt: p.disconnectedAt } : {}),
              ...(p.lastFixAt !== undefined ? { lastFixAt: p.lastFixAt } : {}),
              expectFixes: tracking && this.sharing(p),
            },
            now,
            this.settings,
          );
      if (presence !== p.presence) {
        p.presence = presence;
        this.mark(false);
      }
    }
  }

  // ── roster ────────────────────────────────────────────────────────────────

  private addPlayer(userId: string, name: string, avatar: Avatar, isBot: boolean): RtPlayer {
    const p: RtPlayer = {
      userId,
      name,
      avatar,
      role: null,
      team: null,
      status: "free",
      ready: isBot,
      consentHash: isBot ? this.settingsHash : null,
      joinedAt: this.now,
      isBot,
      boundary: INITIAL_BOUNDARY,
      rescuesDone: 0,
      sockets: 0,
      suspect: null,
      presence: isBot ? "online" : "stale",
    };
    this.players.set(userId, p);
    this.emit("player.joined", { userId }, "all", userId);
    this.persist();
    this.mark(true);
    return p;
  }

  /** Lobby: leaves the roster. Running match: becomes withdrawn (state kept for results). */
  private removeOrWithdraw(p: RtPlayer, now: number) {
    this.dropLocation(p);
    if (this.state === "draft" || this.state === "lobby") {
      this.players.delete(p.userId);
      this.q(() => this.deps.store.deletePlayer(this.id, p.userId));
    } else {
      p.status = "withdrawn";
      p.leftAt = now;
      p.ready = false;
      for (const c of this.captures.values()) {
        if (c.status === "pending" && (c.hiderId === p.userId || c.seekerId === p.userId)) this.setCaptureStatus(c, "expired", null, now);
      }
      this.rescues.delete(p.userId);
      this.persist();
      this.checkVictory(now);
    }
    this.mark(true);
  }

  private withdraw(userId: string): AckResult {
    const p = this.players.get(userId);
    if (!p || p.status === "withdrawn") return fail("not_player");
    if (isTerminal(this.state)) return fail("wrong_state");
    this.emit(this.state === "draft" || this.state === "lobby" ? "player.left" : "player.withdrew", { userId }, "all", userId);
    this.removeOrWithdraw(p, this.now);
    return OK;
  }

  private emergency(client: RtClient): AckResult {
    const p = this.players.get(client.userId);
    if (!p) return fail("not_player");
    // Stop this player's sharing at once; they can re-consent to resume.
    this.dropLocation(p);
    p.consentHash = null;
    if (isPausable(this.state)) this.pause(this.now, p.userId, true);
    else this.emit("match.emergency", { userId: p.userId }, "all", p.userId);
    this.persist();
    this.mark(true);
    return OK;
  }

  // ── location ──────────────────────────────────────────────────────────────

  private sharing(p: RtPlayer) {
    return p.consentHash === this.settingsHash && p.status !== "withdrawn" && p.status !== "eliminated";
  }

  private dropLocation(p: RtPlayer) {
    this.live.delete(p.userId);
    p.suspect = null;
    p.boundary = INITIAL_BOUNDARY;
    // Remove the player's entries from stored ping snapshots too.
    this.pings = this.pings.map((s) => ({ ...s, entries: s.entries.filter((e) => e.userId !== p.userId) }));
  }

  /** Returns an error code for the sender, or null (accepted or silently dropped). */
  private ingestFix(p: RtPlayer, fix: LocationFix, sim: boolean): string | null {
    const now = this.now;
    if (!TRACKING_STATES.includes(this.state)) return "not_tracking";
    if (!this.sharing(p)) return "no_consent";
    if (sim && !(this.settings.simulation && this.deps.allowSim)) return "sim_not_allowed";
    if (p.lastRxAt !== undefined && now - p.lastRxAt < MIN_FIX_INTERVAL_MS) return null;
    p.lastRxAt = now;
    // Server receive time is the authority for freshness (client clocks drift).
    const f: LocationFix = { lat: fix.lat, lng: fix.lng, acc: fix.acc, ts: now, ...(fix.speed !== undefined ? { speed: fix.speed } : {}), ...(fix.heading !== undefined ? { heading: fix.heading } : {}) };
    const j = checkJump(this.live.get(p.userId) ?? null, p.suspect, f, this.settings.location.maxSpeedMps);
    p.suspect = j.suspect;
    if (j.decision !== "accept") return null;
    this.live.set(p.userId, f);
    p.lastFixAt = now;
    if (this.state !== "paused" && (p.status === "free" || p.status === "frozen")) this.stepBoundaryFor(p, f, now);
    this.mark(false);
    return null;
  }

  private stepBoundaryFor(p: RtPlayer, f: LocationFix, now: number) {
    const c = classifyBoundary(f, this.zones, elapsedActiveMs(this.clock, now), this.settings);
    const r = stepBoundary(p.boundary, c, now, this.settings);
    p.boundary = r.state;
    for (const e of r.effects) {
      if (e.type === "warn") {
        this.emit("boundary.warning", { userId: p.userId, warningEndsAt: e.warningEndsAt, zoneId: e.zoneId ?? null }, `user:${p.userId}`, null);
      } else if (e.type === "cleared") {
        this.emit("boundary.cleared", { userId: p.userId }, `user:${p.userId}`, null);
      } else {
        this.applyPenalty(p, e.action, e.zoneId, now);
      }
      this.mark(true);
    }
  }

  private applyPenalty(p: RtPlayer, action: BoundaryPenalty, zoneId: string | undefined, now: number) {
    const payload = { userId: p.userId, action, zoneId: zoneId ?? null };
    if (action === "warn_only") return this.emit("boundary.penalty", payload, `user:${p.userId}`, null);
    this.emit("boundary.penalty", payload, "all", null);
    if (action === "reveal" && p.role) {
      // One exact ping of this player to the opposing role (covered by consent).
      this.takePings("boundary", now, [p.userId], p.role === "hider" ? "seeker" : "hider");
    } else if (action === "eliminate") {
      p.status = "eliminated";
      this.dropLocation(p);
      this.emit("player.eliminated", { userId: p.userId, reason: "boundary" }, "all", null);
      this.persist();
      this.checkVictory(now);
    }
  }

  private viewPlayers(): ViewPlayerInput[] {
    return [...this.players.values()].map((p) => ({
      userId: p.userId,
      name: p.name,
      avatar: p.avatar,
      role: p.role,
      team: p.team,
      status: p.status,
      ready: p.ready,
      consentHash: p.consentHash,
      presence: p.presence,
      isHost: p.userId === this.hostId,
      boundary: p.boundary,
      ...(p.freezeEndsAt !== undefined ? { freezeEndsAt: p.freezeEndsAt } : {}),
      ...(p.jailEndsAt !== undefined ? { jailEndsAt: p.jailEndsAt } : {}),
      rescuesDone: p.rescuesDone,
    }));
  }

  private takePings(reason: PingReason, now: number, targetIds?: string[], only?: Role) {
    const main = findMainZone(this.zones);
    this.grid ??= makeGridOffset(main ? shapeCenter(main.shape)[1] : 0, cryptoRng);
    const audiences: Role[] = only ? [only] : this.settings.visibility.pings.reciprocal ? ["seeker", "hider"] : ["seeker"];
    const players = this.viewPlayers();
    for (const audience of audiences) {
      const snap = takePingSnapshot({
        id: nanoid(10),
        at: now,
        reason,
        audience,
        players,
        settingsHash: this.settingsHash,
        live: this.live,
        settings: this.settings,
        grid: this.grid,
        ...(targetIds ? { targetIds, precision: "exact" as const } : {}),
      });
      this.pings.push(snap);
      this.emit("ping", { reason, count: snap.entries.length, ...(targetIds ? { userIds: targetIds } : {}) }, `role:${audience}`, null);
    }
    if (this.pings.length > 12) this.pings = this.pings.slice(-12);
    this.mark(true);
  }

  // ── captures ──────────────────────────────────────────────────────────────

  private cp(p: RtPlayer): CapturePlayer {
    return {
      userId: p.userId,
      role: p.role,
      status: p.status,
      ...(p.freezeEndsAt !== undefined ? { freezeEndsAt: p.freezeEndsAt } : {}),
      ...(p.jailEndsAt !== undefined ? { jailEndsAt: p.jailEndsAt } : {}),
    };
  }

  private setCp(p: RtPlayer, c: CapturePlayer) {
    p.role = c.role;
    p.team = c.role;
    p.status = c.status;
    if (c.freezeEndsAt !== undefined) p.freezeEndsAt = c.freezeEndsAt;
    else delete p.freezeEndsAt;
    if (c.jailEndsAt !== undefined) p.jailEndsAt = c.jailEndsAt;
    else delete p.jailEndsAt;
  }

  private inSafeZone(hiderId: string, now: number) {
    const fix = this.live.get(hiderId);
    if (!isFresh(fix, now, this.settings.location.staleAfterSec)) return false;
    return this.zones.some((z) => z.enabled && z.type === "safe" && classifyInZone(fix, z, this.settings) === "inside");
  }

  /** `skipSafeZone`: mutual tag requests must not reveal a remote hider's safe-zone status; it is checked on confirmation. */
  private captureCheck(seekerId: string, hiderId: string, method: CaptureRec["method"], now: number, ignorePending = false, skipSafeZone = false) {
    const seeker = this.players.get(seekerId);
    const hider = this.players.get(hiderId);
    if (!seeker || !hider) return fail("not_found", "capture.reject.targetNotHider");
    const check = canCapture({
      state: this.state,
      seeker: this.cp(seeker),
      hider: this.cp(hider),
      method,
      settings: this.settings,
      pendingForHider: !ignorePending && [...this.captures.values()].some((c) => c.status === "pending" && c.hiderId === hiderId),
      hiderInSafeZone: !skipSafeZone && this.inSafeZone(hiderId, now),
    });
    return check.ok ? OK : fail(check.reason, check.key);
  }

  private limited(userId: string) {
    return !this.deps.captureLimiter.take(`${this.id}:${userId}`);
  }

  private tag(seekerId: string, hiderId: string): AckResult {
    if (this.limited(seekerId)) return fail("rate_limited", "errors.rateLimited");
    const now = this.now;
    const check = this.captureCheck(seekerId, hiderId, "mutual", now, false, true);
    if (!check.ok) return check;
    const hider = this.players.get(hiderId)!;
    const hint = proximityHint(this.live.get(seekerId), this.live.get(hiderId), this.settings, now);
    const c: CaptureRec = {
      id: nanoid(),
      seekerId,
      hiderId,
      method: "mutual",
      status: "pending",
      createdAt: now,
      expiresAt: now + this.settings.capture.confirmTimeoutSec * 1000,
      ...(hider.isBot ? { botAcceptAt: now + BOT_REPLY_MS } : {}),
      ...(hint === "far" ? { hint } : {}),
    };
    this.captures.set(c.id, c);
    this.saveCapture(c, null, null);
    this.emit("capture.requested", { captureId: c.id, seekerId, hiderId }, "all", seekerId);
    this.sendTo(hiderId, this.tagPrompt(c));
    this.mark(true);
    // Same ack whether the hider is near, far or in a safe zone: the seeker learns nothing remotely.
    return OK;
  }

  private tagReply(hiderId: string, captureId: string, accept: boolean): AckResult {
    const c = this.captures.get(captureId);
    if (!c || c.hiderId !== hiderId) return fail("not_found");
    if (c.status !== "pending") return OK; // late or duplicate reply: no-op
    const now = this.now;
    let r = OK;
    if (accept) r = this.confirmCapture(c, hiderId, now);
    else {
      this.setCaptureStatus(c, "disputed", hiderId, now);
      this.emit("capture.disputed", { captureId: c.id, seekerId: c.seekerId, hiderId, hint: c.hint ?? null }, "all", hiderId);
    }
    this.mark(true);
    // A rejection (e.g. targetInSafeZone) is explained to the hider in the reply's ack.
    return r;
  }

  /** Applies a capture after re-checking every rule (safe zone included). Returns the rejection, if any. */
  private confirmCapture(c: CaptureRec, by: string, now: number): AckResult {
    const hider = this.players.get(c.hiderId);
    const check = this.captureCheck(c.seekerId, c.hiderId, c.method, now, true);
    if (!hider || !check.ok) {
      this.setCaptureStatus(c, "rejected", by, now);
      this.emit("capture.rejected", { captureId: c.id, seekerId: c.seekerId, hiderId: c.hiderId, reason: check.ok ? "notFound" : check.error }, "all", null);
      return check.ok ? fail("not_found") : check;
    }
    this.setCaptureStatus(c, "confirmed", by, now);
    // Any other open capture of this hider is moot now.
    for (const o of this.captures.values()) if (o !== c && o.status === "pending" && o.hiderId === c.hiderId) this.setCaptureStatus(o, "expired", null, now);
    this.setCp(hider, applyOutcome(this.cp(hider), this.settings, now));
    this.stats = recordCapture(this.stats, c.seekerId, c.hiderId);
    this.emit("capture.confirmed", { captureId: c.id, seekerId: c.seekerId, hiderId: c.hiderId, method: c.method }, "all", by);
    const outcome = this.settings.capture.outcome;
    if (outcome === "convert") this.emit("player.converted", { userId: hider.userId }, "all", null);
    else if (outcome === "eliminate") {
      this.dropLocation(hider);
      this.emit("player.eliminated", { userId: hider.userId, reason: "captured" }, "all", null);
    } else if (outcome === "jail") this.emit("player.jailed", { userId: hider.userId, jailEndsAt: hider.jailEndsAt ?? null }, "all", null);
    else this.emit("player.frozen", { userId: hider.userId, freezeEndsAt: hider.freezeEndsAt ?? null }, "all", null);
    this.persist();
    this.mark(true);
    this.checkVictory(now);
    return OK;
  }

  private qrScan(scannerId: string, token: string): AckResult {
    if (this.limited(scannerId)) return fail("rate_limited", "errors.rateLimited");
    const now = this.now;
    const scanner = this.players.get(scannerId);
    if (!scanner) return fail("not_player");
    const candidates = [...this.players.values()].filter((p) => p.userId !== scannerId && p.role === "hider").map((p) => p.userId);
    const targetId = verifyTagToken(this.deps.tagSecret, this.id, token, now, candidates);
    if (!targetId) return fail("invalid_token", "capture.reject.invalidToken");
    const target = this.players.get(targetId)!;

    if (scanner.role === "hider" && target.status === "jailed") {
      const check = canRescue({ state: this.state, rescuer: this.cp(scanner), jailed: this.cp(target), method: "qr", settings: this.settings, rescuesDone: scanner.rescuesDone, ...(scanner.lastRescueAt !== undefined ? { lastRescueAt: scanner.lastRescueAt } : {}), now });
      if (!check.ok) return fail(check.reason, check.key);
      this.doRescue(scanner, target, now);
      return OK;
    }
    const method = /^\d{6}$/.test(token) ? "code" : "qr";
    const check = this.captureCheck(scannerId, targetId, method, now, true);
    if (!check.ok) return check;
    const c: CaptureRec = { id: nanoid(), seekerId: scannerId, hiderId: targetId, method, status: "pending", createdAt: now, expiresAt: now };
    this.captures.set(c.id, c);
    return this.confirmCapture(c, scannerId, now);
  }

  private rescue(rescuerId: string, jailedId: string): AckResult {
    if (this.limited(rescuerId)) return fail("rate_limited", "errors.rateLimited");
    const now = this.now;
    const rescuer = this.players.get(rescuerId);
    const jailed = this.players.get(jailedId);
    if (!rescuer || !jailed) return fail("not_found");
    const check = canRescue({ state: this.state, rescuer: this.cp(rescuer), jailed: this.cp(jailed), method: "confirm", settings: this.settings, rescuesDone: rescuer.rescuesDone, ...(rescuer.lastRescueAt !== undefined ? { lastRescueAt: rescuer.lastRescueAt } : {}), now });
    if (!check.ok) return fail(check.reason, check.key);
    const r: PendingRescue = { rescuerId, expiresAt: now + RESCUE_PROMPT_MS, ...(jailed.isBot ? { botAcceptAt: now + BOT_REPLY_MS } : {}) };
    this.rescues.set(jailedId, r);
    this.sendTo(jailedId, this.rescuePrompt(r));
    return OK;
  }

  private rescueReply(jailedId: string, rescuerId: string, accept: boolean): AckResult {
    const r = this.rescues.get(jailedId);
    if (!r || r.rescuerId !== rescuerId) return OK; // late or duplicate: no-op
    this.rescues.delete(jailedId);
    if (!accept) return OK;
    const now = this.now;
    const rescuer = this.players.get(rescuerId);
    const jailed = this.players.get(jailedId);
    if (!rescuer || !jailed) return fail("not_found");
    const check = canRescue({ state: this.state, rescuer: this.cp(rescuer), jailed: this.cp(jailed), method: "confirm", settings: this.settings, rescuesDone: rescuer.rescuesDone, ...(rescuer.lastRescueAt !== undefined ? { lastRescueAt: rescuer.lastRescueAt } : {}), now });
    if (!check.ok) return fail(check.reason, check.key);
    this.doRescue(rescuer, jailed, now);
    return OK;
  }

  private doRescue(rescuer: RtPlayer, jailed: RtPlayer, now: number) {
    this.setCp(jailed, applyRescue(this.cp(jailed)));
    rescuer.rescuesDone++;
    rescuer.lastRescueAt = now;
    this.stats = recordRescue(this.stats, rescuer.userId);
    this.emit("player.rescued", { userId: jailed.userId, rescuerId: rescuer.userId }, "all", rescuer.userId);
    this.persist();
    this.mark(true);
  }

  private setCaptureStatus(c: CaptureRec, status: CaptureRec["status"], by: string | null, now: number) {
    c.status = status;
    this.saveCapture(c, now, by);
    if (status !== "pending" && status !== "disputed") this.captures.delete(c.id);
  }

  private saveCapture(c: CaptureRec, resolvedAt: number | null, resolvedBy: string | null) {
    const row = { id: c.id, matchId: this.id, seekerId: c.seekerId, hiderId: c.hiderId, method: c.method, status: c.status, createdAt: c.createdAt, resolvedAt, resolvedBy };
    this.q(() => this.deps.store.upsertCapture(row));
  }

  private tagPrompt(c: CaptureRec): ServerMessage {
    return { t: "prompt", kind: "tagRequest", captureId: c.id, seekerName: this.players.get(c.seekerId)?.name ?? "", expiresAt: c.expiresAt, ...(c.hint ? { hint: c.hint } : {}) };
  }

  private rescuePrompt(r: PendingRescue): ServerMessage {
    return { t: "prompt", kind: "rescueRequest", rescuerId: r.rescuerId, rescuerName: this.players.get(r.rescuerId)?.name ?? "", expiresAt: r.expiresAt };
  }

  // ── dev bots ──────────────────────────────────────────────────────────────

  private runBots(now: number) {
    if (!this.settings.simulation || !this.deps.allowSim || !TRACKING_STATES.includes(this.state) || this.state === "paused") return;
    const main = findMainZone(this.zones);
    if (!main) return;
    const elapsed = elapsedActiveMs(this.clock, now);
    for (const p of this.players.values()) {
      if (!p.isBot || now < (p.botNextFixAt ?? 0) || !this.sharing(p)) continue;
      p.botNextFixAt = now + BOT_FIX_EVERY_MS;
      const center = zoneStateAt(main, elapsed).circle?.center ?? shapeCenter(main.shape);
      if (!p.botPos) {
        const r = inscribedRadiusAt(main.shape, shapeCenter(main.shape)) * 0.6 * Math.sqrt(Math.random());
        p.botPos = destination(shapeCenter(main.shape), r, Math.random() * 360);
        p.botHeading = Math.random() * 360;
      } else {
        p.botHeading = ((p.botHeading ?? 0) + (Math.random() - 0.5) * 70 + 360) % 360;
        let next = destination(p.botPos, 4 + Math.random() * 8, p.botHeading);
        if (effectiveSignedDistanceM(main, next, elapsed) > -20) {
          // Heading out: turn back toward the centre of the effective area.
          const dx = (center[0] - p.botPos[0]) * Math.cos((p.botPos[1] * Math.PI) / 180);
          const dy = center[1] - p.botPos[1];
          p.botHeading = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
          next = destination(p.botPos, 8, p.botHeading);
        }
        p.botPos = next;
      }
      this.ingestFix(p, { lng: p.botPos[0], lat: p.botPos[1], acc: 5, ts: now }, true);
    }
  }

  // ── plumbing ──────────────────────────────────────────────────────────────

  private idsWithRole(role: Role) {
    return [...this.players.values()].filter((p) => p.role === role).map((p) => p.userId);
  }

  private sendError(client: RtClient, code: string) {
    client.send({ t: "error", code, message: code });
  }

  private sendTo(userId: string, msg: ServerMessage) {
    for (const c of this.clients) if (c.userId === userId) c.send(msg);
  }

  private emit(type: MatchEventType, payload: Record<string, EventPayloadValue>, audience: EventAudience = "all", actorId: string | null = null) {
    const e: MatchEvent = { seq: ++this.seq, type, at: this.now, actorId, payload, audience };
    this.events.push(e);
    if (this.events.length > EVENT_BUFFER) this.events.splice(0, this.events.length - EVENT_BUFFER);
    this.q(() => this.deps.store.insertEvent(this.id, e));
    for (const c of this.clients) {
      if (eventVisibleTo(e, { userId: c.userId, role: this.players.get(c.userId)?.role ?? null })) c.send({ t: "event", e });
    }
  }

  private mark(urgent: boolean) {
    for (const c of this.clients) c.dirty = true;
    if (urgent) this.urgent = true;
  }

  /** Sends pending views: urgent changes now, others at most once per VIEW_THROTTLE_MS per client. */
  private flush() {
    const now = this.now;
    const force = this.urgent;
    this.urgent = false;
    let input: ViewInput | undefined;
    for (const c of this.clients) {
      if (!c.dirty || (!force && now - c.lastViewAt < VIEW_THROTTLE_MS)) continue;
      input ??= this.viewInput(now);
      c.send({ t: "view", v: buildView(c.userId, input) });
      c.dirty = false;
      c.lastViewAt = now;
    }
  }

  private viewInput(now: number): ViewInput {
    return {
      match: { id: this.id, groupId: this.groupId, name: this.name, mode: this.mode, state: this.state, settingsHash: this.settingsHash, version: this.version },
      now,
      clock: this.clock,
      settings: this.settings,
      zones: this.zones,
      players: this.viewPlayers(),
      live: this.live,
      pings: this.pings,
      pendingCaptures: [...this.captures.values()]
        .filter((c) => c.status === "pending" || c.status === "disputed")
        .map((c) => ({ captureId: c.id, seekerId: c.seekerId, hiderId: c.hiderId, expiresAt: c.expiresAt, status: c.status as "pending" | "disputed" })),
      ...(this.reveal ? { reveal: this.reveal } : {}),
      ...(this.settings.victory.mode === "points" ? { scores: computeScores(this.stats, this.settings) } : {}),
      ...(this.result ? { result: this.result } : {}),
    };
  }

  private q(fn: () => Promise<unknown>) {
    this.chain = this.chain.then(fn).then(
      () => undefined,
      (err: unknown) => console.error(`[engine] write failed for match ${this.id}:`, err instanceof Error ? err.message : err),
    );
  }

  /** Queues the match row + player rows (no locations). */
  private persist() {
    this.lastSnapshotAt = this.now;
    const snapshot: Snapshot = {
      clock: this.clock,
      ...(this.reveal ? { reveal: this.reveal } : {}),
      ...(this.grid ? { grid: this.grid } : {}),
      pingsDone: this.pingsDone,
      marksDone: this.marksDone,
      overtimeNotified: this.overtimeNotified,
      finalRevealOn: this.finalRevealOn,
      ...(this.lastAccrueAt !== undefined ? { lastAccrueAt: this.lastAccrueAt } : {}),
      stats: this.stats,
      kicked: [...this.kicked],
      players: Object.fromEntries(
        [...this.players.values()].map((p) => [
          p.userId,
          {
            boundary: p.boundary,
            ...(p.freezeEndsAt !== undefined ? { freezeEndsAt: p.freezeEndsAt } : {}),
            ...(p.jailEndsAt !== undefined ? { jailEndsAt: p.jailEndsAt } : {}),
            rescuesDone: p.rescuesDone,
            ...(p.lastRescueAt !== undefined ? { lastRescueAt: p.lastRescueAt } : {}),
          },
        ]),
      ),
      captures: [...this.captures.values()].filter((c) => c.status === "pending" || c.status === "disputed"),
    };
    const row: Partial<MatchRow> = structuredClone({
      name: this.name,
      state: this.state,
      hostId: this.hostId,
      settings: this.settings,
      zones: this.zones,
      settingsHash: this.settingsHash,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      result: this.result ?? null,
      snapshot: snapshot as unknown as Record<string, unknown>,
      version: this.version,
    });
    const players: PlayerRow[] = [...this.players.values()].map((p) => ({
      matchId: this.id,
      userId: p.userId,
      role: p.role,
      team: p.team,
      status: p.status,
      ready: p.ready,
      consentHash: p.consentHash,
      joinedAt: p.joinedAt,
      leftAt: p.leftAt ?? null,
      stats: this.stats[p.userId] ? { ...this.stats[p.userId] } : null,
      isBot: p.isBot,
    }));
    this.q(async () => {
      await this.deps.store.saveMatch(this.id, row);
      await this.deps.store.savePlayers(players);
    });
  }
}
