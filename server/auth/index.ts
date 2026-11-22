import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { and, eq, gt } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Db } from "../db/client";
import { sessions, users } from "../db/schema";

export const SESSION_COOKIE = "jh_session";
export const SESSION_TTL_MS = 180 * 24 * 3600 * 1000;
const BCRYPT_COST = 12;

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const hashPassword = (pw: string) => bcrypt.hash(pw, BCRYPT_COST);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

/** Creates a session; returns the raw token for the cookie (DB keeps only its sha256). */
export async function createSession(db: Db, userId: string, now: number): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.insert(sessions).values({ id: nanoid(), userId, tokenHash: sha256(token), createdAt: now, expiresAt: now + SESSION_TTL_MS, lastSeenAt: now });
  return token;
}

export async function deleteSession(db: Db, token: string) {
  await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
}

export type SessionUser = typeof users.$inferSelect;

/** Resolves a raw token to its user, or null. Touches last_seen_at at most hourly. */
export async function userForToken(db: Db, token: string | undefined, now: number): Promise<SessionUser | null> {
  if (!token || token.length > 128) return null;
  const rows = await db
    .select({ user: users, sessionId: sessions.id, lastSeenAt: sessions.lastSeenAt })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, now)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (now - row.lastSeenAt > 3600_000) await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, row.sessionId));
  return row.user;
}
