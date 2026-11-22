import { describe, expect, it } from "vitest";
import { distanceM, polygonIssues, validateZones, type LngLat } from "@/shared";
import { hopAt, hopStarts, landingIndices } from "@/components/match/RoleReveal";
import { insertVertex, makeZone, moveBehavior, moveShape, nextStage, rectangleAt, removeVertex, withBehaviorKind } from "./zoneEdit";

const c: LngLat = [13.4, 52.5];

describe("zone editing helpers", () => {
  it("rectangle is a valid polygon of the requested size", () => {
    const r = rectangleAt(c, 100, 50);
    expect(polygonIssues(r)).toEqual([]);
    expect(distanceM(r[0], r[1])).toBeCloseTo(200, -1);
  });
  it("inserts and removes vertices, never below 3", () => {
    const r = rectangleAt(c, 100, 100);
    expect(insertVertex(r, 0, c)).toHaveLength(5);
    expect(removeVertex(removeVertex(r, 0), 0)).toHaveLength(3);
  });
  it("moving a main zone moves its stages with it", () => {
    const z = makeZone("main", { kind: "circle", center: c, radiusM: 500 }, "Play area");
    const b = withBehaviorKind(z, "shrinking");
    const to: LngLat = [c[0] + 0.01, c[1]];
    const moved = moveBehavior(b, c, to);
    expect(moveShape(z.shape, c, to)).toMatchObject({ center: to });
    expect(moved.kind === "shrinking" && moved.phases[0].center[0]).toBeCloseTo(to[0]);
  });
  it("default stages fit inside the play area", () => {
    const z = makeZone("main", { kind: "circle", center: c, radiusM: 500 }, "Play area");
    const dyn = { ...z, behavior: withBehaviorKind(z, "shrinking") };
    const b = dyn.behavior;
    if (b.kind !== "shrinking") throw new Error("expected shrinking");
    const two = { ...dyn, behavior: { ...b, phases: [...b.phases, { holdSec: 300, shrinkSec: 120, ...nextStage(dyn) }] } };
    expect(validateZones([two]).filter((i) => i.severity === "error")).toEqual([]);
  });
});

describe("reveal script timing", () => {
  const r = { startsAt: 0, hopMs: [100, 200, 300, 400], hops: ["a", "b", "a", "s"], seekerIds: ["s"] };
  it("finds the hop at a given time and the landing", () => {
    const { starts, total } = hopStarts(r);
    expect(total).toBe(1000);
    expect(hopAt(starts, -5)).toBe(-1);
    expect(hopAt(starts, 150)).toBe(1);
    expect(hopAt(starts, 999)).toBe(3);
    expect(landingIndices(r)).toEqual([3]);
  });
});
