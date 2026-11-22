import type { Role, Zone } from "./schemas/zones";
import type { Settings } from "./schemas/settings";

export type { Role, ZoneType, LngLat, ZoneShape, CircleShape, PolygonShape, Zone, ZoneBehavior, ShrinkPhase, Waypoint } from "./schemas/zones";
export type { Settings, HideSeekSettings, SettingsPatch, CaptureMethod, CaptureOutcome, BoundaryPenalty, PingPrecision, RescueMethod } from "./schemas/settings";

/** Only Hide & Seek now; CTF / zone control add members here. */
export type GameMode = "hide_seek";

export const MATCH_STATES = ["draft", "lobby", "preflight", "countdown", "hiding", "active", "paused", "finished", "archived"] as const;
export type MatchState = (typeof MATCH_STATES)[number];
/** States in which players share GPS and boundaries apply. */
export const TRACKING_STATES: readonly MatchState[] = ["countdown", "hiding", "active", "paused"];

export const PLAYER_STATUSES = ["free", "captured", "jailed", "frozen", "eliminated", "withdrawn"] as const;
export type PlayerStatus = (typeof PLAYER_STATUSES)[number];

export type Presence = "online" | "stale" | "offline";
export type Freshness = "live" | "delayed" | "stale" | "off";

export interface LocationFix {
  lat: number;
  lng: number;
  /** Horizontal accuracy radius, metres. */
  acc: number;
  /** Epoch ms of the reading. */
  ts: number;
  speed?: number;
  heading?: number;
  sim?: boolean;
}

export type Params = Record<string, string | number>;

/** UI text is always an i18n key + params. */
export interface Msg {
  key: string;
  params?: Params;
}

export interface Issue extends Msg {
  /** Dotted settings path (e.g. `visibility.pings.intervalSec`) or `zones.<id>`. */
  path: string;
  severity: "error" | "warning";
}

/** Absolute server epoch ms. Future deadlines shift on resume. */
export interface MatchClock {
  countdownEndsAt?: number;
  hidingEndsAt?: number;
  /** When seekers are released (planned until it passes). */
  activeStartedAt?: number;
  endsAt?: number;
  pausedAt?: number;
  pausedFrom?: "countdown" | "hiding" | "active";
  pausedTotalMs: number;
  /** Paused time that fell after activeStartedAt (excluded from elapsed-active time). */
  activePausedMs: number;
}

export interface Reveal {
  startsAt: number;
  /** How long the reticle rests on hops[i]. */
  hopMs: number[];
  hops: string[];
  seekerIds: string[];
}

export type BoundaryPhase = "ok" | "pending" | "warning" | "penalized";

export interface BoundaryState {
  phase: BoundaryPhase;
  outsideSince?: number;
  outsideFixes: number;
  warningEndsAt?: number;
  /** Zone being violated (main or a restricted zone). */
  zoneId?: string;
}

export interface PlayerStats {
  captures: number;
  timesCaptured: number;
  survivedSec: number;
  rescues: number;
}

export type Winner = "seekers" | "hiders" | "draw";
export type VictoryReason = "allCaught" | "timeUp" | "points" | "noSeekers" | "cancelled";

export interface Scores {
  seekers: number;
  hiders: number;
}

export interface MatchResult {
  winner: Winner;
  reason: VictoryReason;
  endedAt: number;
  scores?: Scores;
  /** Per userId. No coordinates, ever. */
  stats: Record<string, PlayerStats>;
}

export type EventAudience = "all" | `role:${Role}` | `user:${string}`;

export const MATCH_EVENT_TYPES = [
  "match.opened",
  "match.started",
  "match.countdown",
  "match.hiding",
  "match.active",
  "match.paused",
  "match.resumed",
  "match.emergency",
  "match.overtime",
  "match.finished",
  "player.joined",
  "player.left",
  "player.rejoined",
  "player.withdrew",
  "player.kicked",
  "player.consented",
  "player.ready",
  "roles.assigned",
  "capture.requested",
  "capture.confirmed",
  "capture.disputed",
  "capture.rejected",
  "capture.expired",
  "capture.resolved",
  "player.converted",
  "player.eliminated",
  "player.jailed",
  "player.frozen",
  "player.released",
  "player.rescued",
  "ping",
  "zone.warning",
  "zone.transitionStart",
  "zone.transitionEnd",
  "boundary.warning",
  "boundary.cleared",
  "boundary.penalty",
  "settings.changed",
] as const;
export type MatchEventType = (typeof MATCH_EVENT_TYPES)[number];

export type EventPayloadValue = string | number | boolean | null | string[];

export interface MatchEvent {
  seq: number;
  type: MatchEventType;
  at: number;
  actorId: string | null;
  /** Never coordinates. Rendered via `events.<type>` i18n key with these params. */
  payload: Record<string, EventPayloadValue>;
  audience: EventAudience;
}

export type PingReason = "scheduled" | "boundary" | "final";

/** Location entries a viewer is authorised to see. Built only by visibility/buildView. */
export type ViewLocation =
  | { userId: string; kind: "live"; precision: "exact"; lat: number; lng: number; acc: number; at: number }
  | { userId: string; kind: "ping"; precision: "exact"; lat: number; lng: number; acc: number; at: number; reason: PingReason }
  | { userId: string; kind: "ping"; precision: "approx"; lat: number; lng: number; radiusM: number; at: number; reason: PingReason }
  | { userId: string; kind: "ping"; precision: "none"; noSignal: true; at: number; reason: PingReason };

export interface Avatar {
  color: string;
  emoji: string;
}

export interface ViewPlayer {
  userId: string;
  name: string;
  avatar: Avatar;
  role: Role | null;
  team: string | null;
  status: PlayerStatus;
  presence: Presence;
  ready: boolean;
  isHost: boolean;
}

export interface ViewMe {
  userId: string;
  role: Role | null;
  team: string | null;
  status: PlayerStatus;
  isHost: boolean;
  /** settingsHash this player accepted, or null. */
  consent: string | null;
  /** consent matches the current settingsHash. */
  consentValid: boolean;
  ready: boolean;
  /** Client should be sending GPS now. */
  tracking: boolean;
  boundary: { state: BoundaryPhase; warningEndsAt?: number; zoneId?: string };
  freezeEndsAt?: number;
  jailEndsAt?: number;
  rescuesLeft: number;
}

export interface PendingCaptureView {
  captureId: string;
  seekerId: string;
  hiderId: string;
  expiresAt: number;
  status: "pending" | "disputed";
}

export interface MatchView {
  matchId: string;
  groupId: string;
  name: string;
  mode: GameMode;
  state: MatchState;
  settingsHash: string;
  version: number;
  clock: MatchClock & { serverNow: number };
  /** All rules are public by design. */
  settings: Settings;
  zones: Zone[];
  /** null for a viewer who is not a match player (spectating member). */
  me: ViewMe | null;
  players: ViewPlayer[];
  locations: ViewLocation[];
  nextPingAt?: number;
  scores?: Scores;
  pendingCapture?: PendingCaptureView;
  reveal?: Reveal;
  result?: MatchResult;
}

