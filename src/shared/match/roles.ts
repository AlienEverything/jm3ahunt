import type { Reveal } from "../types";

export type Rng = () => number;

/** Fisher–Yates on a copy. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Random seekers at start (never earlier). seekerCount is clamped to 1..n-1. */
export function assignRoles(playerIds: readonly string[], seekerCount: number, rng: Rng): { seekers: string[]; hiders: string[] } {
  if (playerIds.length < 2) throw new Error("At least 2 players are needed to assign roles");
  const k = Math.min(Math.max(1, Math.floor(seekerCount)), playerIds.length - 1);
  const order = shuffle(playerIds, rng);
  return { seekers: order.slice(0, k), hiders: order.slice(k) };
}

const pick = <T>(items: readonly T[], rng: Rng): T => items[Math.min(items.length - 1, Math.floor(rng() * items.length))];

/**
 * "Target lock" script: 12–18 hops (more when there are many seekers) that slow down (ease out)
 * and land on each seeker in turn, the last hop being the last seeker. Total ≈ 4–5 s.
 */
export function buildRevealScript(playerIds: readonly string[], seekerIds: readonly string[], startsAt: number, rng: Rng): Reveal {
  const k = seekerIds.length;
  if (k === 0) return { startsAt, hopMs: [], hops: [], seekerIds: [] };
  const n = Math.max(12 + Math.floor(rng() * 7), k * 3);
  const landings = seekerIds.map((_, j) => Math.round(((j + 1) * n) / k) - 1);

  const hops: string[] = [];
  const weights: number[] = [];
  let seg = 0;
  let segStart = 0;
  for (let i = 0; i < n; i++) {
    if (i === landings[seg]) {
      hops.push(seekerIds[seg]);
      weights.push(1.6); // brief rest on each locked seeker
      seg++;
      segStart = i + 1;
      continue;
    }
    const prev = hops[i - 1];
    const nextLanding = i + 1 === landings[seg] ? seekerIds[seg] : undefined;
    let pool = playerIds.filter((id) => id !== prev && id !== nextLanding);
    if (pool.length === 0) pool = playerIds.filter((id) => id !== prev);
    hops.push(pick(pool, rng));
    const segLen = Math.max(1, landings[seg] - segStart);
    const q = (i - segStart) / segLen; // 0 → 1 within the segment
    weights.push(0.15 + q * q); // fast → slow
  }

  if (playerIds.length === 2) {
    // Two players: strictly alternate so the last hop lands on the seeker without a repeat.
    const other = playerIds.find((id) => id !== seekerIds[0]) ?? seekerIds[0];
    for (let i = 0; i < n; i++) hops[i] = (n - 1 - i) % 2 === 0 ? seekerIds[0] : other;
  }

  const totalMs = 4000 + Math.floor(rng() * 1000);
  const sum = weights.reduce((a, b) => a + b, 0);
  const hopMs = weights.map((w) => Math.round((w / sum) * totalMs));
  return { startsAt, hopMs, hops, seekerIds: [...seekerIds] };
}

/** Unbiased-enough crypto randomness for real matches (role picks, grid offsets). */
export const cryptoRng: Rng = () => globalThis.crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;

/** Deterministic PRNG for tests and reproducible scripts (mulberry32). */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
