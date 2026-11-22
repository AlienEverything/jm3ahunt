import type { Settings } from "../schemas/settings";
import type { Zone } from "../schemas/zones";
import type { Issue } from "../types";
import { validateZones } from "../zones/validate";

export const MIN_PING_INTERVAL_SEC = 30;

export interface SettingsContext {
  zones?: readonly Zone[];
  /** Players expected in the match (lobby size); enables player-count checks. */
  playerCount?: number;
  /** Server allows simulation (ALLOW_SIM_GPS and not production). */
  allowSimulation?: boolean;
}

const err = (path: string, key: string, params?: Issue["params"]): Issue => ({ path, severity: "error", key: `issues.settings.${key}`, ...(params ? { params } : {}) });
const warn = (path: string, key: string, params?: Issue["params"]): Issue => ({ path, severity: "warning", key: `issues.settings.${key}`, ...(params ? { params } : {}) });

/** Cross-field rules. Structural ranges are enforced by the zod schema. */
export function validateSettings(s: Settings, ctx: SettingsContext = {}): Issue[] {
  const out: Issue[] = [];
  const { general, timing, roles, visibility, capture, jail, victory, boundary } = s;
  const pings = visibility.pings;

  if (general.minPlayers > general.maxPlayers) out.push(err("general.minPlayers", "minAboveMax"));
  if (roles.assignment === "random" && roles.seekerCount >= general.maxPlayers) {
    out.push(err("roles.seekerCount", "seekersFillMatch", { max: general.maxPlayers - 1 }));
  }
  if (ctx.playerCount !== undefined) {
    if (ctx.playerCount < general.minPlayers) out.push(err("general.minPlayers", "notEnoughPlayers", { min: general.minPlayers, count: ctx.playerCount }));
    if (ctx.playerCount > general.maxPlayers) out.push(err("general.maxPlayers", "tooManyPlayers", { max: general.maxPlayers, count: ctx.playerCount }));
    if (roles.assignment === "random" && ctx.playerCount >= 2 && roles.seekerCount >= ctx.playerCount) {
      out.push(err("roles.seekerCount", "seekersNotBelowPlayers", { count: ctx.playerCount }));
    }
  }

  if (pings.enabled) {
    if (pings.intervalSec < MIN_PING_INTERVAL_SEC) out.push(err("visibility.pings.intervalSec", "pingIntervalTooShort", { min: MIN_PING_INTERVAL_SEC }));
    if (pings.firstPingAfterSec >= timing.durationMin * 60) out.push(warn("visibility.pings.firstPingAfterSec", "firstPingAfterEnd"));
    if (pings.precision === "exact") out.push(warn("visibility.pings.precision", "exactPings"));
  }
  if (pings.finalRevealMin > timing.durationMin) out.push(err("visibility.pings.finalRevealMin", "finalRevealTooLong", { max: timing.durationMin }));

  if (capture.methods.length === 0) out.push(err("capture.methods", "noCaptureMethod"));
  if (timing.hidingSec === 0) out.push(warn("timing.hidingSec", "noHeadStart"));

  if (capture.outcome === "jail") {
    if (ctx.zones && !ctx.zones.some((z) => z.enabled && z.type === "jail")) out.push(err("capture.outcome", "jailZoneMissing"));
    if (jail.maxJailSec === 0 && !jail.rescue.enabled) out.push(warn("jail.maxJailSec", "jailForever"));
  }

  if (victory.mode === "points" && victory.pointsPerCapture === 0 && victory.pointsPerMinute === 0) {
    out.push(err("victory.pointsPerCapture", "pointsAllZero"));
  }

  if (boundary.penalty === "eliminate" && boundary.graceSec < 15) out.push(warn("boundary.graceSec", "harshBoundary"));
  if (boundary.penalty === "reveal" && pings.precision === "approx") {
    // Consent covers it, but players should know a boundary reveal is exact.
    out.push(warn("boundary.penalty", "revealIsExact"));
  }

  if (s.simulation && !ctx.allowSimulation) out.push(err("simulation", "simulationNotAllowed"));

  if (ctx.zones) out.push(...validateZones(ctx.zones, { durationMin: timing.durationMin }));
  return out;
}

export const hasErrors = (issues: readonly Issue[]) => issues.some((i) => i.severity === "error");
