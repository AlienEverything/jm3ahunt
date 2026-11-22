import { createHmac, timingSafeEqual } from "node:crypto";

/** QR / 6-digit tag tokens rotate every 30 s, HMAC-bound to match + player. */
export const TAG_WINDOW_MS = 30_000;
/** A token from the previous window is still accepted this long after it rotated. */
const GRACE_MS = 5_000;

const hmac = (secret: string, data: string) => createHmac("sha256", secret).update(data).digest();

const sig = (secret: string, matchId: string, userId: string, win: number) =>
  hmac(secret, `tag|${matchId}|${userId}|${win}`).subarray(0, 16).toString("base64url");

const code = (secret: string, matchId: string, userId: string, win: number) =>
  String(hmac(secret, `code|${matchId}|${userId}|${win}`).readUInt32BE(0) % 1_000_000).padStart(6, "0");

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function issueTagToken(secret: string, matchId: string, userId: string, now: number) {
  const win = Math.floor(now / TAG_WINDOW_MS);
  return { token: `${userId}.${win}.${sig(secret, matchId, userId, win)}`, code: code(secret, matchId, userId, win), expiresAt: (win + 1) * TAG_WINDOW_MS };
}

function validWindows(now: number): number[] {
  const cur = Math.floor(now / TAG_WINDOW_MS);
  return now - cur * TAG_WINDOW_MS < GRACE_MS ? [cur, cur - 1] : [cur];
}

/** Returns the player the token or code belongs to, or null. `candidates` = players who may show one. */
export function verifyTagToken(secret: string, matchId: string, token: string, now: number, candidates: readonly string[]): string | null {
  const wins = validWindows(now);
  if (/^\d{6}$/.test(token)) {
    for (const id of candidates) for (const w of wins) if (same(code(secret, matchId, id, w), token)) return id;
    return null;
  }
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, winStr, s] = parts;
  const win = Number(winStr);
  if (!candidates.includes(userId) || !wins.includes(win)) return null;
  return same(sig(secret, matchId, userId, win), s) ? userId : null;
}
