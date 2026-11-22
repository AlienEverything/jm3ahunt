import { EARTH_RADIUS_M, type LatLng } from "../geo";
import { isFresh } from "../location";
import { inFinalReveal, nextPingAt } from "../match/clock";
import type { Rng } from "../match/roles";
import type { Settings } from "../schemas/settings";
import { ROLES, type Role, type Zone } from "../schemas/zones";
import {
  TRACKING_STATES,
  type Avatar,
  type BoundaryState,
  type GameMode,
  type LocationFix,
  type MatchClock,
  type MatchEvent,
  type MatchResult,
  type MatchState,
  type MatchView,
  type PendingCaptureView,
  type PingReason,
  type PlayerStatus,
  type Presence,
  type Reveal,
  type Scores,
  type ViewLocation,
} from "../types";

// ── approximation ───────────────────────────────────────────────────────────

/** Per-match random grid. refLat fixes the metres-per-degree scale for the whole match. */
export interface GridOffset {
  refLat: number;
  /** Fractions of a cell in [0, 1). */
  ox: number;
  oy: number;
}

export const makeGridOffset = (refLat: number, rng: Rng): GridOffset => ({ refLat, ox: rng(), oy: rng() });

const M_PER_DEG = (EARTH_RADIUS_M * Math.PI) / 180;
// shortcut: equirectangular grid at refLat; 2% margin keeps the true point inside the circle for
// points within ~50 km of refLat. Use a proper projected grid if play areas ever get larger.
const APPROX_SAFETY = 0.98;

/**
 * Snap to the cell centre of a per-match offset grid (cell = r·√2 so the half-diagonal is r).
 * The true point is always inside the returned circle, and a stationary player always maps to the
 * same circle, so repeated pings leak nothing new.
 */
export function approximate(p: LatLng, radiusM: number, g: GridOffset): { lat: number; lng: number; radiusM: number } {
  const cell = radiusM * Math.SQRT2 * APPROX_SAFETY;
  const kx = M_PER_DEG * Math.cos((g.refLat * Math.PI) / 180);
  const x = (p.lng * kx) / cell - g.ox;
  const y = (p.lat * M_PER_DEG) / cell - g.oy;
  return {
    lng: ((Math.floor(x) + 0.5 + g.ox) * cell) / kx,
    lat: ((Math.floor(y) + 0.5 + g.oy) * cell) / M_PER_DEG,
    radiusM,
  };
}

// ── inputs the server runtime fills ─────────────────────────────────────────

export interface ViewPlayerInput {
  userId: string;
  name: string;
  avatar: Avatar;
  role: Role | null;
  team: string | null;
  status: PlayerStatus;
  ready: boolean;
  /** settingsHash the player accepted; null = no consent. */
  consentHash: string | null;
  presence: Presence;
  isHost: boolean;
  boundary?: BoundaryState;
  freezeEndsAt?: number;
  jailEndsAt?: number;
  rescuesDone?: number;
}

export type PingEntry = Extract<ViewLocation, { kind: "ping" }>;

/** Taken at ping time; coordinates already reduced to what the audience may see. */
export interface PingSnapshot {
  id: string;
  at: number;
  reason: PingReason;
  /** Role that receives this snapshot. */
  audience: Role;
  entries: PingEntry[];
}

type FixLookup = ReadonlyMap<string, LocationFix> | Readonly<Record<string, LocationFix | undefined>>;
const getFix = (live: FixLookup, id: string): LocationFix | undefined =>
  live instanceof Map ? live.get(id) : (live as Record<string, LocationFix | undefined>)[id];

export interface ViewInput {
  match: { id: string; groupId: string; name: string; mode: GameMode; state: MatchState; settingsHash: string; version: number };
  now: number;
  clock: MatchClock;
  settings: Settings;
  zones: readonly Zone[];
  players: readonly ViewPlayerInput[];
  /** Latest accepted fix per consenting player (server memory only). */
  live: FixLookup;
  /** Latest snapshots the runtime keeps (scheduled, boundary reveal). */
  pings: readonly PingSnapshot[];
  pendingCaptures: readonly PendingCaptureView[];
  reveal?: Reveal;
  scores?: Scores;
  result?: MatchResult;
}

/** A player contributes location data only with valid consent and while still playing. */
const shares = (p: ViewPlayerInput, hash: string) => p.consentHash === hash && p.status !== "withdrawn" && p.status !== "eliminated";

export interface PingSnapshotInput {
  id: string;
  at: number;
  reason: PingReason;
  audience: Role;
  players: readonly ViewPlayerInput[];
  settingsHash: string;
  live: FixLookup;
  settings: Settings;
  grid: GridOffset;
  /** Default: every sharing player of the opposite role. Boundary reveals pass the one player. */
  targetIds?: readonly string[];
  /** Default: settings precision; boundary reveals are exact. */
  precision?: "exact" | "approx";
}

/** Snapshot of targets' fresh locations at ping time. Stale targets get a "no signal" entry. */
export function takePingSnapshot(i: PingSnapshotInput): PingSnapshot {
  const targetRole: Role = i.audience === "seeker" ? "hider" : "seeker";
  const precision = i.precision ?? i.settings.visibility.pings.precision;
  const targets = i.players.filter(
    (p) => shares(p, i.settingsHash) && (i.targetIds ? i.targetIds.includes(p.userId) : p.role === targetRole),
  );
  const entries: PingEntry[] = targets.map((p) => {
    const fix = getFix(i.live, p.userId);
    if (!isFresh(fix, i.at, i.settings.location.staleAfterSec)) {
      return { userId: p.userId, kind: "ping", precision: "none", noSignal: true, at: i.at, reason: i.reason };
    }
    if (precision === "exact") {
      return { userId: p.userId, kind: "ping", precision: "exact", lat: fix.lat, lng: fix.lng, acc: fix.acc, at: i.at, reason: i.reason };
    }
    const a = approximate(fix, i.settings.visibility.pings.approxRadiusM, i.grid);
    return { userId: p.userId, kind: "ping", precision: "approx", lat: a.lat, lng: a.lng, radiusM: a.radiusM, at: i.at, reason: i.reason };
  });
  return { id: i.id, at: i.at, reason: i.reason, audience: i.audience, entries };
}

// ── the view ────────────────────────────────────────────────────────────────

const zoneVisible = (z: Zone, role: Role | null) => z.enabled && (role ? z.visibleTo.includes(role) : ROLES.every((r) => z.visibleTo.includes(r)));

/**
 * The ONLY producer of coordinates for clients. Own fix exact; same-role live per settings;
 * opponents only through pings / final reveal / boundary reveal. Host status grants nothing.
 */
export function buildView(viewerId: string, input: ViewInput): MatchView {
  const { match, settings, now, clock } = input;
  const hash = match.settingsHash;
  const viewer = input.players.find((p) => p.userId === viewerId);
  const tracking = TRACKING_STATES.includes(match.state);
  const consentValid = !!viewer && viewer.consentHash === hash;
  const role = viewer?.role ?? null;

  const locations: ViewLocation[] = [];
  if (viewer && tracking && consentValid && viewer.status !== "withdrawn") {
    const own = getFix(input.live, viewer.userId);
    if (own) locations.push({ userId: viewer.userId, kind: "live", precision: "exact", lat: own.lat, lng: own.lng, acc: own.acc, at: own.ts });
  }

  // Eliminated / withdrawn viewers and viewers without consent receive nobody else's location.
  if (viewer && tracking && consentValid && role && viewer.status !== "withdrawn" && viewer.status !== "eliminated") {
    const vis = settings.visibility;
    const finalReveal = inFinalReveal(match.state, clock, settings, now);
    const seen = new Set<string>([viewer.userId]);

    for (const p of input.players) {
      if (p.userId === viewer.userId || !p.role || !shares(p, hash)) continue;
      const fix = getFix(input.live, p.userId);
      if (!isFresh(fix, now, settings.location.staleAfterSec)) continue;
      const sameRole = p.role === role;
      const teamLive = sameRole && (role === "seeker" ? vis.seekersSeeSeekers : vis.hidersSeeHiders);
      const revealLive = !sameRole && finalReveal && (p.role === "hider" || vis.pings.reciprocal);
      if (!teamLive && !revealLive) continue;
      locations.push({ userId: p.userId, kind: "live", precision: "exact", lat: fix.lat, lng: fix.lng, acc: fix.acc, at: fix.ts });
      seen.add(p.userId);
    }

    const latestPing = new Map<string, PingEntry>();
    for (const snap of input.pings) {
      if (snap.audience !== role) continue;
      for (const e of snap.entries) {
        const target = input.players.find((p) => p.userId === e.userId);
        if (!target || seen.has(e.userId) || !shares(target, hash)) continue;
        const prev = latestPing.get(e.userId);
        if (!prev || e.at >= prev.at) latestPing.set(e.userId, e);
      }
    }
    locations.push(...latestPing.values());
  }

  const pendingCapture = input.pendingCaptures.find((c) => c.seekerId === viewerId || c.hiderId === viewerId);
  const ping = settings.visibility.pings.enabled && role && tracking ? nextPingAt(clock, settings, now) : undefined;

  return {
    matchId: match.id,
    groupId: match.groupId,
    name: match.name,
    mode: match.mode,
    state: match.state,
    settingsHash: hash,
    version: match.version,
    clock: { ...clock, serverNow: now },
    settings,
    zones: input.zones.filter((z) => zoneVisible(z, role)),
    me: viewer
      ? {
          userId: viewer.userId,
          role,
          team: viewer.team,
          status: viewer.status,
          isHost: viewer.isHost,
          consent: viewer.consentHash,
          consentValid,
          ready: viewer.ready,
          tracking: tracking && consentValid && viewer.status !== "withdrawn" && viewer.status !== "eliminated",
          boundary: {
            state: viewer.boundary?.phase ?? "ok",
            ...(viewer.boundary?.warningEndsAt !== undefined ? { warningEndsAt: viewer.boundary.warningEndsAt } : {}),
            ...(viewer.boundary?.zoneId !== undefined ? { zoneId: viewer.boundary.zoneId } : {}),
          },
          ...(viewer.freezeEndsAt !== undefined ? { freezeEndsAt: viewer.freezeEndsAt } : {}),
          ...(viewer.jailEndsAt !== undefined ? { jailEndsAt: viewer.jailEndsAt } : {}),
          rescuesLeft:
            settings.capture.outcome === "jail" && settings.jail.rescue.enabled
              ? Math.max(0, settings.jail.rescue.maxRescues - (viewer.rescuesDone ?? 0))
              : 0,
        }
      : null,
    players: input.players.map((p) => ({
      userId: p.userId,
      name: p.name,
      avatar: p.avatar,
      role: p.role,
      team: p.team,
      status: p.status,
      presence: p.presence,
      ready: p.ready,
      isHost: p.isHost,
    })),
    locations,
    ...(ping !== undefined ? { nextPingAt: ping } : {}),
    ...(input.scores && settings.victory.mode === "points" ? { scores: input.scores } : {}),
    ...(pendingCapture ? { pendingCapture } : {}),
    ...(input.reveal ? { reveal: input.reveal } : {}),
    ...(input.result ? { result: input.result } : {}),
  };
}

/** Audience filter for events. */
export function eventVisibleTo(e: MatchEvent, viewer: { userId: string; role: Role | null }): boolean {
  if (e.audience === "all") return true;
  if (e.audience.startsWith("role:")) return viewer.role === e.audience.slice(5);
  return e.audience === `user:${viewer.userId}`;
}
