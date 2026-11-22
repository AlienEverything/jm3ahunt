import { describe, expect, it } from "vitest";
import { assignRoles, buildRevealScript, seededRng } from "./roles";

const ids = ["a", "b", "c", "d", "e", "f"];

describe("assignRoles", () => {
  it("is deterministic for a seed and partitions all players", () => {
    const r1 = assignRoles(ids, 2, seededRng(42));
    const r2 = assignRoles(ids, 2, seededRng(42));
    expect(r1).toEqual(r2);
    expect(r1.seekers).toHaveLength(2);
    expect([...r1.seekers, ...r1.hiders].sort()).toEqual(ids);
  });

  it("different seeds give different picks (randomness is used)", () => {
    const picks = new Set(Array.from({ length: 20 }, (_, i) => assignRoles(ids, 1, seededRng(i)).seekers[0]));
    expect(picks.size).toBeGreaterThan(2);
  });

  it("clamps seekerCount to 1..n-1 and needs 2 players", () => {
    expect(assignRoles(["a", "b"], 5, seededRng(1)).seekers).toHaveLength(1);
    expect(assignRoles(["a", "b", "c"], 0, seededRng(1)).seekers).toHaveLength(1);
    expect(() => assignRoles(["a"], 1, seededRng(1))).toThrow();
  });
});

describe("buildRevealScript", () => {
  it("12–18 hops, no repeats, lands on each seeker in order, ends on the last seeker, totals 4–5 s", () => {
    for (let seed = 0; seed < 50; seed++) {
      const { seekers } = assignRoles(ids, 1 + (seed % 3), seededRng(seed));
      const r = buildRevealScript(ids, seekers, 5000, seededRng(seed + 1000));
      expect(r.hops.length).toBeGreaterThanOrEqual(12);
      expect(r.hops.length).toBeLessThanOrEqual(18);
      expect(r.hopMs).toHaveLength(r.hops.length);
      for (let i = 1; i < r.hops.length; i++) expect(r.hops[i]).not.toBe(r.hops[i - 1]);
      expect(r.hops.at(-1)).toBe(seekers.at(-1));
      // seekers appear as landings in order
      let next = 0;
      for (const h of r.hops) if (h === seekers[next]) next++;
      expect(next).toBe(seekers.length);
      const total = r.hopMs.reduce((a, b) => a + b, 0);
      expect(total).toBeGreaterThanOrEqual(3990);
      expect(total).toBeLessThanOrEqual(5010);
      expect(r.seekerIds).toEqual(seekers);
      expect(r.startsAt).toBe(5000);
    }
  });

  it("eases out: hops get slower within the first segment", () => {
    const r = buildRevealScript(ids, ["c"], 0, seededRng(7));
    expect(r.hopMs[r.hopMs.length - 2]).toBeGreaterThan(r.hopMs[0]);
  });

  it("is deterministic for a seed; works with two players", () => {
    expect(buildRevealScript(ids, ["b"], 0, seededRng(3))).toEqual(buildRevealScript(ids, ["b"], 0, seededRng(3)));
    const two = buildRevealScript(["x", "y"], ["y"], 0, seededRng(9));
    for (let i = 1; i < two.hops.length; i++) expect(two.hops[i]).not.toBe(two.hops[i - 1]);
    expect(two.hops.at(-1)).toBe("y");
  });
});
