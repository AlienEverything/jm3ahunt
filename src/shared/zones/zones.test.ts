import { describe, expect, it } from "vitest";
import { distanceM } from "../geo";
import { CENTER, at, circle, mainZone, zone } from "../test-helpers";
import type { Zone, ZoneBehavior } from "../schemas/zones";
import { buildShrinkBehavior, zonesAtPoint } from "./build";
import { effectiveSignedDistanceM, timelineMarks, timelineTotalMs, zoneStateAt } from "./timeline";
import { validateZones } from "./validate";

const shrinking: ZoneBehavior = {
  kind: "shrinking",
  startDelaySec: 60,
  warningSec: 30,
  phases: [
    { holdSec: 0, shrinkSec: 100, center: CENTER, radiusM: 600 },
    { holdSec: 120, shrinkSec: 60, center: at(100), radiusM: 300 },
  ],
};
const main = mainZone(1000, { behavior: shrinking });
const S = 1000;

describe("zoneStateAt", () => {
  it("static main zone has no dynamic circle", () => {
    const s = zoneStateAt(mainZone(), 123_456);
    expect(s).toMatchObject({ kind: "static", phase: "static", circle: null, msUntilNextChange: null, warning: false });
  });

  it("start delay: full area, counts down to the first shrink, warns in the last 30 s", () => {
    const s0 = zoneStateAt(main, 0);
    expect(s0).toMatchObject({ phase: "delay", phaseIndex: 0, phaseCount: 2, warning: false, msUntilNextChange: 60 * S });
    expect(s0.circle?.radiusM).toBe(1000);
    expect(s0.nextCircle?.radiusM).toBe(600);
    expect(zoneStateAt(main, 29_999).warning).toBe(false);
    expect(zoneStateAt(main, 30 * S).warning).toBe(true);
  });

  it("shrink 1 interpolates linearly; boundaries of the window are exact", () => {
    const start = zoneStateAt(main, 60 * S);
    expect(start).toMatchObject({ phase: "transition", phaseIndex: 0, progress: 0 });
    expect(start.circle?.radiusM).toBe(1000);
    const mid = zoneStateAt(main, 110 * S);
    expect(mid.progress).toBeCloseTo(0.5);
    expect(mid.circle?.radiusM).toBeCloseTo(800);
    expect(mid.msUntilNextChange).toBe(50 * S);
    const end = zoneStateAt(main, 160 * S);
    expect(end).toMatchObject({ phase: "hold", phaseIndex: 1 });
    expect(end.circle?.radiusM).toBe(600);
  });

  it("hold 2 then a moving shrink (centre and radius both interpolate)", () => {
    expect(zoneStateAt(main, 249_999)).toMatchObject({ phase: "hold", warning: false });
    expect(zoneStateAt(main, 250 * S)).toMatchObject({ phase: "hold", warning: true, msUntilNextChange: 30 * S });
    const mid = zoneStateAt(main, 310 * S);
    expect(mid.phase).toBe("transition");
    expect(mid.circle?.radiusM).toBeCloseTo(450);
    expect(distanceM(mid.circle!.center, CENTER)).toBeCloseTo(50, 0);
  });

  it("final: stays on the last circle forever", () => {
    const f = zoneStateAt(main, 340 * S);
    expect(f).toMatchObject({ phase: "final", phaseIndex: 2, nextCircle: null, msUntilNextChange: null, warning: false });
    expect(f.circle?.radiusM).toBe(300);
    expect(zoneStateAt(main, 99_999 * S).circle?.radiusM).toBe(300);
    expect(timelineTotalMs(main)).toBe(340 * S);
  });

  it("moving waypoints use the same hold → move rule", () => {
    const moving = mainZone(1000, {
      behavior: { kind: "moving", startDelaySec: 0, warningSec: 0, waypoints: [{ center: at(300), radiusM: 400, holdSec: 10, moveSec: 20 }] },
    });
    expect(zoneStateAt(moving, 5 * S)).toMatchObject({ phase: "hold", kind: "moving" });
    expect(zoneStateAt(moving, 20 * S).circle?.radiusM).toBeCloseTo(700);
    expect(distanceM(zoneStateAt(moving, 30 * S).circle!.center, at(300))).toBeLessThan(0.01);
  });

  it("marks: warning, start, end per phase, sorted", () => {
    expect(timelineMarks(main)).toEqual([
      { atMs: 30 * S, type: "warning", phaseIndex: 0 },
      { atMs: 60 * S, type: "transitionStart", phaseIndex: 0 },
      { atMs: 160 * S, type: "transitionEnd", phaseIndex: 0 },
      { atMs: 250 * S, type: "warning", phaseIndex: 1 },
      { atMs: 280 * S, type: "transitionStart", phaseIndex: 1 },
      { atMs: 340 * S, type: "transitionEnd", phaseIndex: 1 },
    ]);
    expect(timelineMarks(mainZone())).toEqual([]);
  });

  it("effective boundary = approved area ∩ current circle", () => {
    const p = at(700);
    expect(effectiveSignedDistanceM(main, p, 0)).toBeCloseTo(-300, 0); // only the approved area constrains
    expect(effectiveSignedDistanceM(main, p, 200 * S)).toBeCloseTo(100, 0); // outside the 600 m circle
  });
});

describe("validateZones", () => {
  const keys = (zs: Zone[], ctx = {}) => validateZones(zs, ctx).map((i) => `${i.severity}:${i.key.replace("issues.zones.", "")}`);

  it("valid layout has no issues", () => {
    const zs = [mainZone(), zone("safe", circle(at(300), 50)), zone("jail", circle(at(500, 180), 40)), zone("restricted", circle(at(600, 0), 60))];
    expect(validateZones(zs)).toEqual([]);
  });

  it("no main / multiple main", () => {
    expect(keys([zone("safe", circle(CENTER, 50))])).toContain("error:noMain");
    expect(keys([mainZone(), zone("main", circle(CENTER, 500))])).toContain("error:multipleMain");
    expect(keys([mainZone(1000, { enabled: false })])).toContain("error:noMain");
  });

  it("radius range", () => {
    expect(keys([mainZone(5)])).toContain("error:radiusTooSmall");
    expect(keys([mainZone(25_000)])).toContain("error:radiusTooLarge");
  });

  it("polygon problems", () => {
    const bow = zone("main", { kind: "polygon", ring: [at(500, 0), at(500, 180), at(500, 90), at(500, 270)] });
    expect(keys([bow])).toContain("error:polygonSelfIntersecting");
    const few = zone("main", { kind: "polygon", ring: [CENTER, at(100), CENTER] });
    expect(keys([few])).toContain("error:polygonTooFewPoints");
  });

  it("safe ∩ restricted, inner zones touching restricted or outside the area", () => {
    const r = zone("restricted", circle(at(300), 100), { name: "Road" });
    expect(keys([mainZone(), r, zone("safe", circle(at(350), 100))])).toContain("error:safeIntersectsRestricted");
    expect(keys([mainZone(), r, zone("spawn", circle(at(250), 100))])).toContain("error:zoneTouchesRestricted");
    expect(keys([mainZone(), zone("jail", circle(at(1200), 50))])).toContain("error:zoneOutsideArea");
    expect(keys([mainZone(), zone("objective", circle(at(950), 100))])).toContain("error:zoneOutsideArea");
  });

  it("dynamic behaviour only on main; phases inside the area; warnings", () => {
    const badBehavior = zone("safe", circle(CENTER, 50), { behavior: shrinking });
    expect(keys([mainZone(), badBehavior])).toContain("error:behaviorMainOnly");

    const outside = mainZone(1000, {
      behavior: { kind: "shrinking", startDelaySec: 0, warningSec: 0, phases: [{ holdSec: 0, shrinkSec: 10, center: at(800), radiusM: 400 }] },
    });
    expect(keys([outside])).toContain("error:phaseOutsideArea");

    const growing = mainZone(1000, {
      behavior: {
        kind: "shrinking",
        startDelaySec: 0,
        warningSec: 0,
        phases: [
          { holdSec: 0, shrinkSec: 10, center: CENTER, radiusM: 300 },
          { holdSec: 0, shrinkSec: 10, center: CENTER, radiusM: 500 },
        ],
      },
    });
    expect(keys([growing])).toContain("warning:shrinkRadiusIncreases");
    expect(keys([main], { durationMin: 5 })).toContain("warning:timelineExceedsDuration");
    expect(keys([main], { durationMin: 30 })).not.toContain("warning:timelineExceedsDuration");
    expect(keys([mainZone(), zone("restricted", circle(at(5000), 50))])).toContain("warning:restrictedOutsidePlayArea");
  });
});

describe("zone helpers", () => {
  it("buildShrinkBehavior centres phases inside the approved area", () => {
    const b = buildShrinkBehavior(mainZone(1000), { startDelaySec: 0, warningSec: 0, steps: [{ holdSec: 0, shrinkSec: 60, radiusFrac: 0.5 }] });
    expect(b.kind === "shrinking" && b.phases[0].radiusM).toBe(500);
    expect(validateZones([mainZone(1000, { behavior: b })])).toEqual([]);
  });

  it("zonesAtPoint orders by priority; jail only for jailed players", () => {
    const zs = [mainZone(), zone("safe", circle(CENTER, 100)), zone("jail", circle(CENTER, 80)), zone("restricted", circle(at(500), 50))];
    const p = { lng: CENTER[0], lat: CENTER[1] };
    expect(zonesAtPoint(zs, p).map((z) => z.type)).toEqual(["safe", "main"]);
    expect(zonesAtPoint(zs, p, { jailed: true }).map((z) => z.type)).toEqual(["jail", "safe", "main"]);
  });
});
