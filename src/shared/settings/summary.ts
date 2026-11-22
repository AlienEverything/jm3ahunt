import type { Settings } from "../schemas/settings";
import type { Zone } from "../schemas/zones";
import type { Msg } from "../types";
import { findMainZone } from "../zones/validate";

export type SummarySection = "match" | "sharing" | "capture" | "zones";
export interface SummaryLine extends Msg {
  section: SummarySection;
}

/**
 * Plain-language rules, as i18n keys + params. Duration params end in `Sec`/`Min`; en.ts formats
 * them with `{name|duration}`. The "sharing" section states exactly what each role shares.
 */
export function summarizeSettings(s: Settings, zones: readonly Zone[] = []): SummaryLine[] {
  const out: SummaryLine[] = [];
  const add = (section: SummarySection, key: string, params?: Msg["params"]) =>
    out.push({ section, key: `summary.${key}`, ...(params ? { params } : {}) });
  const { timing, roles, visibility: vis, capture, jail, victory, boundary } = s;
  const p = vis.pings;

  // Match
  add("match", timing.hidingSec > 0 ? "timing" : "timingNoHeadStart", {
    durationMin: timing.durationMin,
    hidingSec: timing.hidingSec,
    countdownSec: timing.countdownSec,
  });
  if (timing.overtimeSec > 0) add("match", "overtime", { overtimeSec: timing.overtimeSec });
  if (roles.assignment === "random") add("match", "rolesRandom", { seekerCount: roles.seekerCount });
  else add("match", "rolesManual");
  if (victory.mode === "standard") add("match", "victoryStandard");
  else add("match", "victoryPoints", { pointsPerCapture: victory.pointsPerCapture, pointsPerMinute: victory.pointsPerMinute });

  // Sharing — what each role shares, with whom, and when.
  add("sharing", "share.own");
  add("sharing", vis.seekersSeeSeekers ? "share.seekersLiveToSeekers" : "share.seekersNotToSeekers");
  add("sharing", vis.hidersSeeHiders ? "share.hidersLiveToHiders" : "share.hidersNotToHiders");
  if (p.enabled) {
    const params = { intervalSec: p.intervalSec, firstPingAfterSec: p.firstPingAfterSec, approxRadiusM: p.approxRadiusM };
    add("sharing", p.precision === "approx" ? "share.hidersPingApprox" : "share.hidersPingExact", params);
    if (p.reciprocal) add("sharing", p.precision === "approx" ? "share.seekersPingApprox" : "share.seekersPingExact", params);
    else add("sharing", "share.seekersNotToHiders");
  } else {
    add("sharing", "share.noPings");
  }
  if (p.finalRevealMin > 0) add("sharing", p.reciprocal ? "share.finalRevealBoth" : "share.finalReveal", { finalRevealMin: p.finalRevealMin });
  if (boundary.penalty === "reveal") add("sharing", "share.boundaryReveal", { graceSec: boundary.graceSec });
  add("sharing", "share.hostNoExtra");
  add("sharing", "share.pausedWhenLocked");

  // Capture
  if (capture.methods.includes("mutual")) add("capture", "captureMutual", { confirmTimeoutSec: capture.confirmTimeoutSec });
  if (capture.methods.includes("qr") || capture.methods.includes("code")) add("capture", "captureQr");
  if (capture.outcome === "convert") add("capture", "outcome.convert");
  if (capture.outcome === "eliminate") add("capture", "outcome.eliminate");
  if (capture.outcome === "freeze") add("capture", "outcome.freeze", { freezeSec: capture.freezeSec });
  if (capture.outcome === "jail") {
    add("capture", jail.maxJailSec > 0 ? "outcome.jail" : "outcome.jailNoRelease", { maxJailSec: jail.maxJailSec });
    if (jail.rescue.enabled) add("capture", jail.rescue.method === "qr" ? "rescueQr" : "rescueConfirm", { maxRescues: jail.rescue.maxRescues });
  }
  add("capture", `boundary.${boundary.penalty}`, { debounceSec: boundary.debounceSec, graceSec: boundary.graceSec });

  // Zones
  const main = findMainZone(zones);
  if (main?.behavior.kind === "shrinking") add("zones", "zones.shrinking", { count: main.behavior.phases.length });
  if (main?.behavior.kind === "moving") add("zones", "zones.moving", { count: main.behavior.waypoints.length });
  const count = (type: Zone["type"]) => zones.filter((z) => z.enabled && z.type === type).length;
  if (count("safe")) add("zones", "zones.safe", { count: count("safe") });
  if (count("restricted")) add("zones", "zones.restricted", { count: count("restricted") });
  return out;
}
