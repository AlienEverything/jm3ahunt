import { describe, expect, it } from "vitest";
import { at, circle, fixAt, mainZone, settingsWith, zone } from "../test-helpers";
import type { BoundaryState } from "../types";
import {
  INITIAL_BOUNDARY,
  checkJump,
  classifyBoundary,
  classifyFreshness,
  classifyInZone,
  classifyPresence,
  stepBoundary,
  type BoundaryClassification,
} from ".";

const s = settingsWith(); // maxAccuracyM 50, toleranceM 10, debounce 20 s, grace 45 s
const zones = [mainZone(1000), zone("restricted", circle(at(500, 0), 100), { id: "lake" })];

describe("freshness & presence", () => {
  it("live < 10 s, delayed < staleAfterSec, stale after, off without a fix", () => {
    expect(classifyFreshness(1000, 10_999, 45)).toBe("live");
    expect(classifyFreshness(1000, 11_000, 45)).toBe("delayed");
    expect(classifyFreshness(1000, 46_000, 45)).toBe("stale");
    expect(classifyFreshness(null, 0, 45)).toBe("off");
  });

  it("presence: offline 30 s after disconnect, stale without fixes while tracking", () => {
    expect(classifyPresence({ socketOpen: true, expectFixes: false }, 0, s)).toBe("online");
    expect(classifyPresence({ socketOpen: true, expectFixes: true, lastFixAt: 0 }, 44_999, s)).toBe("online");
    expect(classifyPresence({ socketOpen: true, expectFixes: true, lastFixAt: 0 }, 45_000, s)).toBe("stale");
    expect(classifyPresence({ socketOpen: false, disconnectedAt: 0, expectFixes: false }, 29_999, s)).toBe("stale");
    expect(classifyPresence({ socketOpen: false, disconnectedAt: 0, expectFixes: false }, 30_000, s)).toBe("offline");
  });
});

describe("jump filter", () => {
  const a = fixAt(at(0), 0, 5);
  it("accepts plausible movement, holds a jump as suspect until confirmed", () => {
    expect(checkJump(null, null, a, 12).decision).toBe("accept");
    expect(checkJump(a, null, fixAt(at(50), 10_000, 5), 12).decision).toBe("accept");
    const jump = fixAt(at(2000), 10_000, 5); // 200 m/s
    const r = checkJump(a, null, jump, 12);
    expect(r).toEqual({ decision: "suspect", suspect: jump });
    // next fix near the suspect confirms it
    expect(checkJump(a, r.suspect, fixAt(at(2020), 12_000, 5), 12).decision).toBe("accept");
    // next fix back near the old position is accepted normally and clears the suspect
    expect(checkJump(a, r.suspect, fixAt(at(10), 12_000, 5), 12)).toEqual({ decision: "accept", suspect: null });
  });
  it("accuracy slack: big accuracy circles explain apparent jumps", () => {
    expect(checkJump(a, null, fixAt(at(300), 10_000, 250), 12).decision).toBe("accept");
  });
  it("drops out-of-order fixes", () => {
    expect(checkJump(fixAt(at(0), 5000), null, fixAt(at(0), 4000), 12).decision).toBe("drop");
  });
});

describe("boundary classifier", () => {
  it("inside / outside / uncertain with accuracy and tolerance", () => {
    expect(classifyBoundary(fixAt(at(900, 90), 0, 50), zones, 0, s).state).toBe("inside"); // d=-100 ≤ -50
    expect(classifyBoundary(fixAt(at(980, 90), 0, 30), zones, 0, s).state).toBe("uncertain");
    expect(classifyBoundary(fixAt(at(1025, 90), 0, 20), zones, 0, s).state).toBe("uncertain"); // 25 ≤ acc 20 + tol 10
    expect(classifyBoundary(fixAt(at(1050, 90), 0, 20), zones, 0, s)).toEqual({ state: "outside", zoneId: "main", reason: "main" });
  });

  it("scenario 7: poor accuracy near (or even across) the boundary is never outside", () => {
    for (const d of [950, 1000, 1050, 1200, 2000]) {
      expect(classifyBoundary(fixAt(at(d, 90), 0, 80), zones, 0, s).state).toBe("uncertain");
    }
    expect(classifyBoundary(fixAt(at(1040, 90), 0, 45), zones, 0, s).state).toBe("uncertain");
  });

  it("restricted zones count as violations", () => {
    expect(classifyBoundary(fixAt(at(500, 0), 0, 10), zones, 0, s)).toEqual({ state: "outside", zoneId: "lake", reason: "restricted" });
    expect(classifyBoundary(fixAt(at(395, 0), 0, 10), zones, 0, s).state).toBe("uncertain");
    expect(classifyBoundary(fixAt(at(300, 0), 0, 10), zones, 0, s).state).toBe("inside");
  });

  it("uses the shrunk circle at the given elapsed time", () => {
    const shrinking = [
      mainZone(1000, { behavior: { kind: "shrinking", startDelaySec: 0, warningSec: 0, phases: [{ holdSec: 0, shrinkSec: 0, center: at(0), radiusM: 400 }] } }),
    ];
    expect(classifyBoundary(fixAt(at(600, 90), 0, 5), shrinking, 1, s).state).toBe("outside");
  });

  it("safe-zone check needs confident inside", () => {
    const safe = zone("safe", circle(at(0), 100));
    expect(classifyInZone(fixAt(at(20), 0, 10), safe, s)).toBe("inside");
    expect(classifyInZone(fixAt(at(95), 0, 10), safe, s)).toBe("uncertain");
    expect(classifyInZone(fixAt(at(20), 0, 60), safe, s)).toBe("uncertain");
    expect(classifyInZone(fixAt(at(300), 0, 10), safe, s)).toBe("outside");
  });
});

describe("penalty pipeline", () => {
  const out: BoundaryClassification = { state: "outside", zoneId: "main", reason: "main" };
  const unc: BoundaryClassification = { state: "uncertain", zoneId: "main", reason: "main" };
  const ins: BoundaryClassification = { state: "inside" };
  const run = (steps: Array<[BoundaryClassification, number]>, settings = s) => {
    let st: BoundaryState = INITIAL_BOUNDARY;
    const effects: string[] = [];
    for (const [c, now] of steps) {
      const r = stepBoundary(st, c, now, settings);
      st = r.state;
      effects.push(...r.effects.map((e) => (e.type === "penalty" ? `penalty:${e.action}` : e.type)));
    }
    return { st, effects };
  };

  it("one outside reading never warns", () => {
    expect(run([[out, 0]]).st.phase).toBe("pending");
    expect(run([[out, 0]]).effects).toEqual([]);
  });

  it("debounce needs ≥ debounceSec and ≥ 2 fixes", () => {
    expect(run([[out, 0], [out, 19_999]]).st.phase).toBe("pending");
    const r = run([[out, 0], [out, 20_000]]);
    expect(r.st.phase).toBe("warning");
    expect(r.st.warningEndsAt).toBe(65_000);
    expect(r.effects).toEqual(["warn"]);
  });

  it("grace: penalty only when still outside at warningEndsAt, once", () => {
    const r = run([[out, 0], [out, 20_000], [out, 64_999], [out, 65_000], [out, 70_000]], settingsWith({ boundary: { penalty: "eliminate" } }));
    expect(r.effects).toEqual(["warn", "penalty:eliminate"]);
    expect(r.st.phase).toBe("penalized");
  });

  it("uncertain readings never advance (scenario 7)", () => {
    const r = run([[out, 0], [unc, 10_000], [unc, 30_000], [unc, 100_000]]);
    expect(r.st.phase).toBe("pending");
    expect(r.st.outsideFixes).toBe(1);
    expect(r.effects).toEqual([]);
    // and a long uncertain stretch during warning does not trigger the penalty
    const w = run([[out, 0], [out, 20_000], [unc, 200_000]]);
    expect(w.effects).toEqual(["warn"]);
  });

  it("returning inside clears the pipeline", () => {
    const r = run([[out, 0], [out, 20_000], [ins, 30_000], [out, 40_000]]);
    expect(r.effects).toEqual(["warn", "cleared"]);
    expect(r.st).toMatchObject({ phase: "pending", outsideSince: 40_000, outsideFixes: 1 });
    expect(run([[out, 0], [ins, 5000]]).effects).toEqual([]);
  });
});
