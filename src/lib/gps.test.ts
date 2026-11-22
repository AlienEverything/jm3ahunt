import { describe, expect, it } from "vitest";
import { destination } from "@/shared";
import { shouldSend, type GpsFix } from "./gps";

const at = (lng: number, lat: number): GpsFix => ({ lng, lat, acc: 5, ts: 0 });
const base = at(10, 50);

describe("GPS send rule (SPEC §10)", () => {
  it("sends the first fix", () => expect(shouldSend(base, null, 0)).toBe(true));
  it("never sends more than every 2 s, even after a big move", () => {
    const [lng, lat] = destination([10, 50], 100, 90);
    expect(shouldSend(at(lng, lat), { fix: base, at: 0 }, 1_999)).toBe(false);
  });
  it("sends after moving 5 m", () => {
    const [lng, lat] = destination([10, 50], 5.5, 0);
    expect(shouldSend(at(lng, lat), { fix: base, at: 0 }, 2_500)).toBe(true);
    const [l2, a2] = destination([10, 50], 3, 0);
    expect(shouldSend(at(l2, a2), { fix: base, at: 0 }, 2_500)).toBe(false);
  });
  it("sends after 10 s without moving", () => expect(shouldSend(base, { fix: base, at: 0 }, 10_000)).toBe(true));
});
