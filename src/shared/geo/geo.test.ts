import { describe, expect, it } from "vitest";
import { CENTER, at, circle } from "../test-helpers";
import type { LngLat, ZoneShape } from "../schemas/zones";
import {
  circleToPolygon,
  circleWithinShape,
  destination,
  distanceM,
  enclosingCircle,
  inscribedRadiusAt,
  pointInShape,
  polygonIssues,
  shapesIntersect,
  shapeWithinShape,
  signedDistanceM,
} from ".";

/** ~2 km square around CENTER. */
const square: ZoneShape = {
  kind: "polygon",
  ring: [at(1414, 315), at(1414, 45), at(1414, 135), at(1414, 225)],
};

describe("geo", () => {
  it("distance and destination agree", () => {
    const p = destination(CENTER, 500, 37);
    expect(distanceM(CENTER, p)).toBeCloseTo(500, 3);
    expect(distanceM(CENTER, CENTER)).toBe(0);
  });

  it("circle → polygon is closed and on the radius", () => {
    const ring = circleToPolygon(CENTER, 300, 32);
    expect(ring).toHaveLength(33);
    expect(ring[0]).toEqual(ring[32]);
    for (const v of ring) expect(distanceM(CENTER, v)).toBeCloseTo(300, 3);
  });

  it("signed distance: negative inside, positive outside (circle)", () => {
    const c = circle(CENTER, 100);
    expect(signedDistanceM(at(40), c)).toBeCloseTo(-60, 3);
    expect(signedDistanceM(at(130), c)).toBeCloseTo(30, 3);
    expect(pointInShape(at(99), c)).toBe(true);
    expect(pointInShape(at(101), c)).toBe(false);
  });

  it("signed distance: negative inside, positive outside (polygon)", () => {
    // square half-width is 1000 m (1414 m to the corners)
    expect(signedDistanceM(CENTER, square)).toBeCloseTo(-1000, -1);
    expect(signedDistanceM(at(900, 90), square)).toBeCloseTo(-100, -1);
    expect(signedDistanceM(at(1100, 90), square)).toBeCloseTo(100, -1);
    expect(pointInShape(at(1100, 90), square)).toBe(false);
  });

  it("polygon validity", () => {
    expect(polygonIssues(square.kind === "polygon" ? square.ring : [])).toEqual([]);
    const a = at(500, 0);
    const b = at(500, 90);
    const c = at(500, 180);
    const d = at(500, 270);
    expect(polygonIssues([a, c, b, d])).toContain("selfIntersecting"); // bow-tie
    expect(polygonIssues([a, b, a])).toEqual(["tooFewPoints"]);
    expect(polygonIssues([a, b, b, a])).toEqual(["tooFewPoints"]);
    const line: LngLat[] = [CENTER, at(100, 90), at(200, 90)];
    expect(polygonIssues(line)).toContain("zeroArea");
    // closed ring input is accepted too
    expect(polygonIssues([a, b, c, d, a])).toEqual([]);
  });

  it("containment and intersection", () => {
    const big = circle(CENTER, 1000);
    expect(circleWithinShape(at(500), 400, big)).toBe(true);
    expect(circleWithinShape(at(700), 400, big)).toBe(false);
    expect(circleWithinShape(CENTER, 900, square)).toBe(true);
    expect(circleWithinShape(CENTER, 1100, square)).toBe(false);
    expect(shapeWithinShape(square, circle(CENTER, 1500))).toBe(true);
    expect(shapeWithinShape(square, big)).toBe(false);
    expect(shapeWithinShape(circle(CENTER, 200), square)).toBe(true);
    expect(shapesIntersect(circle(at(1500), 600), big)).toBe(true);
    expect(shapesIntersect(circle(at(3000), 600), big)).toBe(false);
    expect(shapesIntersect(circle(at(1050, 90), 100), square)).toBe(true);
    expect(shapesIntersect(circle(at(1300, 90), 100), square)).toBe(false);
    const far: ZoneShape = { kind: "polygon", ring: [at(5000, 0), at(5000, 90), at(6000, 45)] };
    expect(shapesIntersect(far, square)).toBe(false);
  });

  it("enclosing and inscribed circles", () => {
    expect(enclosingCircle(circle(CENTER, 300))).toEqual({ center: CENTER, radiusM: 300 });
    const e = enclosingCircle(square);
    expect(e.radiusM).toBeGreaterThan(1400);
    expect(inscribedRadiusAt(square, CENTER)).toBeCloseTo(1000, -1);
    expect(inscribedRadiusAt(square, at(5000))).toBe(0);
  });
});
