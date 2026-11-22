import { describe, expect, it } from "vitest";
import { formatDuration, hasMessage, t, tm } from "@/i18n";
import { DEFAULT_SETTINGS, withDefaults } from "../defaults";
import { BUILT_IN_PRESETS } from "../presets";
import { SettingsSchema } from "../schemas/settings";
import { CENTER, at, circle, mainZone, settingsWith, zone } from "../test-helpers";
import type { Issue } from "../types";
import { validateZones } from "../zones/validate";
import { buildShrinkBehavior } from "../zones/build";
import { canonicalJson, settingsHash } from "./hash";
import { SETTINGS_FIELDS, getAt, setAt, visibleFields } from "./meta";
import { summarizeSettings } from "./summary";
import { validateSettings } from "./validate";

const keysOf = (issues: Issue[]) => issues.map((i) => `${i.severity}:${i.key.split(".").at(-1)}`);

describe("defaults and presets", () => {
  it("defaults and every built-in preset pass the schema and have no validation errors", () => {
    expect(SettingsSchema.parse(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
    expect(validateSettings(DEFAULT_SETTINGS)).toEqual([]);
    for (const p of BUILT_IN_PRESETS) {
      expect(() => SettingsSchema.parse(p.settings)).not.toThrow();
      expect(validateSettings(p.settings).filter((i) => i.severity === "error")).toEqual([]);
      expect(hasMessage(p.nameKey) && hasMessage(p.descriptionKey)).toBe(true);
    }
    const casual = BUILT_IN_PRESETS.find((p) => p.id === "casual")!;
    expect(casual.settings.visibility.pings.enabled).toBe(false);
    expect(casual.settings.timing.durationMin).toBe(20);
  });

  it("shrinking preset template yields a valid 3-phase layout", () => {
    const sh = BUILT_IN_PRESETS.find((p) => p.id === "shrinking_hunt")!;
    const main = mainZone(1200);
    const zones = [{ ...main, behavior: buildShrinkBehavior(main, sh.mainShrink!) }];
    expect(validateZones(zones, { durationMin: sh.settings.timing.durationMin })).toEqual([]);
  });

  it("withDefaults fills gaps and rejects unknown keys / bad values", () => {
    expect(withDefaults({ timing: { durationMin: 45 } }).timing).toEqual({ ...DEFAULT_SETTINGS.timing, durationMin: 45 });
    expect(() => withDefaults({ timing: { durationMin: -1 } })).toThrow();
    expect(() => withDefaults({ bogus: true })).toThrow();
  });
});

describe("settings metadata", () => {
  it("covers every setting leaf exactly once", () => {
    const leaves: string[] = [];
    const walk = (o: unknown, p: string) => {
      if (o && typeof o === "object" && !Array.isArray(o)) for (const [k, v] of Object.entries(o)) walk(v, p ? `${p}.${k}` : k);
      else leaves.push(p);
    };
    walk(DEFAULT_SETTINGS, "");
    const paths = SETTINGS_FIELDS.map((f) => f.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect([...paths].sort()).toEqual(leaves.filter((l) => l !== "mode").sort());
  });

  it("every field has a label, help text, option labels and a recommended default", () => {
    for (const f of SETTINGS_FIELDS) {
      expect(hasMessage(f.labelKey), f.labelKey).toBe(true);
      expect(hasMessage(f.helpKey), f.helpKey).toBe(true);
      for (const o of f.options ?? []) expect(hasMessage(o.labelKey), o.labelKey).toBe(true);
      expect(f.recommended).toEqual(getAt(DEFAULT_SETTINGS, f.path));
    }
  });

  it("dependsOn hides irrelevant fields (progressive disclosure)", () => {
    const paths = (s = DEFAULT_SETTINGS, adv = true) => visibleFields(s, "visibility", adv).map((f) => f.path);
    expect(paths()).toContain("visibility.pings.intervalSec");
    expect(paths(settingsWith({ visibility: { pings: { enabled: false } } }))).not.toContain("visibility.pings.intervalSec");
    expect(paths(settingsWith({ visibility: { pings: { precision: "exact" } } }))).not.toContain("visibility.pings.approxRadiusM");
    expect(paths(DEFAULT_SETTINGS, false)).not.toContain("visibility.pings.approxRadiusM");
    expect(visibleFields(DEFAULT_SETTINGS, "jail", true)).toEqual([]);
    expect(visibleFields(settingsWith({ capture: { outcome: "jail" } }), "jail", true).length).toBeGreaterThan(0);
  });

  it("getAt / setAt are immutable path helpers", () => {
    const next = setAt(DEFAULT_SETTINGS, "visibility.pings.intervalSec", 600);
    expect(getAt(next, "visibility.pings.intervalSec")).toBe(600);
    expect(DEFAULT_SETTINGS.visibility.pings.intervalSec).toBe(300);
    expect(next.timing).toBe(DEFAULT_SETTINGS.timing);
  });
});

describe("validateSettings", () => {
  it("cross-field errors and warnings", () => {
    const k = (patch: Parameters<typeof settingsWith>[0], ctx = {}) => keysOf(validateSettings(settingsWith(patch), ctx));
    expect(k({ general: { minPlayers: 10, maxPlayers: 5 } })).toContain("error:minAboveMax");
    expect(k({ general: { maxPlayers: 3 }, roles: { seekerCount: 3 } })).toContain("error:seekersFillMatch");
    expect(k({ roles: { seekerCount: 2 } }, { playerCount: 2 })).toContain("error:seekersNotBelowPlayers");
    expect(k({ roles: { seekerCount: 2, assignment: "manual" } }, { playerCount: 2 })).not.toContain("error:seekersNotBelowPlayers");
    expect(k({}, { playerCount: 1 })).toContain("error:notEnoughPlayers");
    expect(k({}, { playerCount: 16 })).toContain("error:tooManyPlayers");
    expect(k({ visibility: { pings: { intervalSec: 20 } } })).toContain("error:pingIntervalTooShort");
    expect(k({ visibility: { pings: { enabled: false, intervalSec: 20 } } })).not.toContain("error:pingIntervalTooShort");
    expect(k({ timing: { durationMin: 10 }, visibility: { pings: { firstPingAfterSec: 600 } } })).toContain("warning:firstPingAfterEnd");
    expect(k({ visibility: { pings: { precision: "exact" } } })).toContain("warning:exactPings");
    expect(k({ timing: { durationMin: 10 }, visibility: { pings: { finalRevealMin: 11 } } })).toContain("error:finalRevealTooLong");
    expect(k({ capture: { methods: [] } })).toContain("error:noCaptureMethod");
    expect(k({ timing: { hidingSec: 0 } })).toContain("warning:noHeadStart");
    expect(k({ capture: { outcome: "jail" } }, { zones: [mainZone()] })).toContain("error:jailZoneMissing");
    expect(k({ capture: { outcome: "jail" } }, { zones: [mainZone(), zone("jail", circle(at(100), 30))] })).not.toContain("error:jailZoneMissing");
    expect(k({ capture: { outcome: "jail" }, jail: { maxJailSec: 0, rescue: { enabled: false } } })).toContain("warning:jailForever");
    expect(k({ victory: { mode: "points", pointsPerCapture: 0, pointsPerMinute: 0 } })).toContain("error:pointsAllZero");
    expect(k({ boundary: { penalty: "eliminate", graceSec: 5 } })).toContain("warning:harshBoundary");
    expect(k({ boundary: { penalty: "reveal" } })).toContain("warning:revealIsExact");
    expect(k({ simulation: true })).toContain("error:simulationNotAllowed");
    expect(k({ simulation: true }, { allowSimulation: true })).not.toContain("error:simulationNotAllowed");
    expect(k({}, { zones: [] })).toContain("error:noMain");
  });

  it("every issue key exists in en.ts", () => {
    const all = [
      ...validateSettings(settingsWith({ general: { minPlayers: 10, maxPlayers: 5 }, capture: { methods: [], outcome: "jail" }, visibility: { pings: { intervalSec: 5, precision: "exact", finalRevealMin: 999 } }, timing: { hidingSec: 0 }, simulation: true, victory: { mode: "points", pointsPerCapture: 0, pointsPerMinute: 0 }, boundary: { penalty: "eliminate", graceSec: 1 }, jail: { maxJailSec: 0, rescue: { enabled: false } } }), { zones: [], playerCount: 1 }),
      ...validateSettings(settingsWith({ boundary: { penalty: "reveal" }, roles: { seekerCount: 20 } }), { playerCount: 30 }),
    ];
    expect(all.length).toBeGreaterThan(15);
    for (const i of all) expect(hasMessage(i.key), i.key).toBe(true);
    const zoneKeys = ["noMain", "multipleMain", "radiusTooSmall", "radiusTooLarge", "polygonTooFewPoints", "polygonSelfIntersecting", "polygonZeroArea", "behaviorMainOnly", "safeIntersectsRestricted", "zoneTouchesRestricted", "zoneOutsideArea", "restrictedOutsidePlayArea", "phaseOutsideArea", "shrinkRadiusIncreases", "timelineExceedsDuration"];
    for (const z of zoneKeys) expect(hasMessage(`issues.zones.${z}`), z).toBe(true);
  });
});

describe("summary", () => {
  const variants = [
    DEFAULT_SETTINGS,
    settingsWith({ visibility: { hidersSeeHiders: true, seekersSeeSeekers: false, pings: { precision: "exact", reciprocal: true, finalRevealMin: 5 } }, boundary: { penalty: "reveal" } }),
    settingsWith({ visibility: { pings: { enabled: false } }, timing: { hidingSec: 0, overtimeSec: 60 }, roles: { assignment: "manual" } }),
    settingsWith({ capture: { outcome: "jail" }, jail: { maxJailSec: 0, rescue: { method: "qr" } }, victory: { mode: "points" } }),
    settingsWith({ capture: { outcome: "freeze", methods: ["qr"] } }),
    settingsWith({ capture: { outcome: "eliminate" }, boundary: { penalty: "host_review" } }),
    ...BUILT_IN_PRESETS.map((p) => p.settings),
  ];
  const zones = [
    mainZone(1000, { behavior: { kind: "shrinking", startDelaySec: 0, warningSec: 0, phases: [{ holdSec: 0, shrinkSec: 10, center: CENTER, radiusM: 500 }] } }),
    zone("safe", circle(at(100), 20)),
    zone("restricted", circle(at(600), 20)),
  ];

  it("every line's key exists and renders without leftover placeholders", () => {
    for (const s of variants) {
      for (const line of summarizeSettings(s, zones)) {
        expect(hasMessage(line.key), line.key).toBe(true);
        expect(tm(line)).not.toMatch(/\{\w+(\|\w+)?\}/);
      }
    }
  });

  it("states exactly what each role shares", () => {
    const sharing = (s: typeof DEFAULT_SETTINGS) => summarizeSettings(s).filter((l) => l.section === "sharing").map((l) => l.key.replace("summary.share.", ""));
    expect(sharing(DEFAULT_SETTINGS)).toEqual(["own", "seekersLiveToSeekers", "hidersNotToHiders", "hidersPingApprox", "seekersNotToHiders", "hostNoExtra", "pausedWhenLocked"]);
    expect(sharing(variants[1])).toEqual(["own", "seekersNotToSeekers", "hidersLiveToHiders", "hidersPingExact", "seekersPingExact", "finalRevealBoth", "boundaryReveal", "hostNoExtra", "pausedWhenLocked"]);
    expect(sharing(variants[2])).toContain("noPings");
    expect(tm(summarizeSettings(DEFAULT_SETTINGS).find((l) => l.key === "summary.share.hidersPingApprox")!)).toContain("every 5 min");
  });
});

describe("settingsHash", () => {
  it("is stable under key order and changes with any rule or zone change", async () => {
    const zones = [mainZone()];
    const h1 = await settingsHash(DEFAULT_SETTINGS, zones);
    const shuffled = Object.fromEntries(Object.entries(DEFAULT_SETTINGS).reverse()) as typeof DEFAULT_SETTINGS;
    expect(await settingsHash(shuffled, zones)).toBe(h1);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(await settingsHash(settingsWith({ visibility: { pings: { intervalSec: 600 } } }), zones)).not.toBe(h1);
    expect(await settingsHash(DEFAULT_SETTINGS, [mainZone(999)])).not.toBe(h1);
  });

  it("canonical JSON sorts keys and drops undefined", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: undefined } })).toBe('{"a":{"d":[3,{"y":2,"z":1}]},"b":1}');
  });
});

describe("i18n", () => {
  it("interpolates params and formats durations", () => {
    expect(t("issues.settings.pingIntervalTooShort", { min: 30 })).toBe("Pings must be at least 30 seconds apart.");
    expect(formatDuration(90)).toBe("1 min 30 s");
    expect(formatDuration(300)).toBe("5 min");
    expect(formatDuration(3660)).toBe("1 h 1 min");
    expect(formatDuration(0)).toBe("0 s");
    expect(tm({ key: "summary.overtime", params: { overtimeSec: 120 } })).toContain("2 min");
    expect(tm({ key: "no.such.key" })).toBe("no.such.key");
  });
});
