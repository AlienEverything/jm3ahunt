// DB writes for match runtimes. Nothing here ever receives coordinates.
import { and, desc, eq, sql } from "drizzle-orm";
import type { MatchEvent, MatchResult, PlayerStats, Role } from "@/shared";
import type { Db } from "../db/client";
import { captures, matchEvents, matches, matchPlayers, users, type UserStats } from "../db/schema";

export type MatchRow = typeof matches.$inferSelect;
export type PlayerRow = typeof matchPlayers.$inferInsert;
export type CaptureRow = typeof captures.$inferInsert;

export const EMPTY_USER_STATS: UserStats = { matches: 0, wins: 0, captures: 0, timesCaptured: 0, rescues: 0 };

export function createStore(db: Db) {
  return {
    async saveMatch(id: string, patch: Partial<Omit<MatchRow, "id" | "groupId" | "createdAt">>) {
      await db.update(matches).set(patch).where(eq(matches.id, id));
    },

    async savePlayers(rows: PlayerRow[]) {
      if (rows.length === 0) return;
      const stmts = rows.map((r) =>
        db
          .insert(matchPlayers)
          .values(r)
          .onConflictDoUpdate({
            target: [matchPlayers.matchId, matchPlayers.userId],
            set: { role: r.role, team: r.team, status: r.status, ready: r.ready, consentHash: r.consentHash, leftAt: r.leftAt ?? null, stats: r.stats ?? null },
          }),
      );
      await db.batch(stmts as [(typeof stmts)[number], ...typeof stmts]);
    },

    async deletePlayer(matchId: string, userId: string) {
      await db.delete(matchPlayers).where(and(eq(matchPlayers.matchId, matchId), eq(matchPlayers.userId, userId)));
    },

    async insertBotUser(id: string, name: string, now: number) {
      await db.insert(users).values({ id, displayName: name, avatarColor: "#6B7280", avatarEmoji: "🤖", createdAt: now, stats: EMPTY_USER_STATS });
    },

    async insertEvent(matchId: string, e: MatchEvent) {
      await db.insert(matchEvents).values({
        id: `${matchId}:${e.seq}`,
        matchId,
        seq: e.seq,
        type: e.type,
        actorId: e.actorId,
        payload: e.payload,
        audience: e.audience,
        createdAt: e.at,
      });
    },

    async upsertCapture(row: CaptureRow) {
      await db
        .insert(captures)
        .values(row)
        .onConflictDoUpdate({ target: captures.id, set: { status: row.status, resolvedAt: row.resolvedAt ?? null, resolvedBy: row.resolvedBy ?? null } });
    },

    /** Adds this match to each real player's lifetime stats. */
    async addUserStats(result: MatchResult, finalRoles: Record<string, Role | null>, botIds: Set<string>) {
      for (const [userId, s] of Object.entries(result.stats) as [string, PlayerStats][]) {
        if (botIds.has(userId)) continue;
        const role = finalRoles[userId];
        const won = (result.winner === "seekers" && role === "seeker") || (result.winner === "hiders" && role === "hider");
        const row = await db.select({ stats: users.stats }).from(users).where(eq(users.id, userId)).get();
        const cur = { ...EMPTY_USER_STATS, ...(row?.stats ?? {}) };
        await db
          .update(users)
          .set({
            stats: {
              matches: cur.matches + 1,
              wins: cur.wins + (won ? 1 : 0),
              captures: cur.captures + s.captures,
              timesCaptured: cur.timesCaptured + s.timesCaptured,
              rescues: cur.rescues + s.rescues,
            },
          })
          .where(eq(users.id, userId));
      }
    },

    async loadMatch(id: string) {
      const match = await db.select().from(matches).where(eq(matches.id, id)).get();
      if (!match) return null;
      const players = await db
        .select({ p: matchPlayers, name: users.displayName, color: users.avatarColor, emoji: users.avatarEmoji })
        .from(matchPlayers)
        .innerJoin(users, eq(users.id, matchPlayers.userId))
        .where(eq(matchPlayers.matchId, id))
        .orderBy(matchPlayers.joinedAt);
      const events = await db.select().from(matchEvents).where(eq(matchEvents.matchId, id)).orderBy(desc(matchEvents.seq)).limit(200);
      const caps = await db.select().from(captures).where(eq(captures.matchId, id));
      return { match, players, events: events.reverse(), captures: caps };
    },

    async nonTerminalMatchIds(): Promise<string[]> {
      const rows = await db
        .select({ id: matches.id })
        .from(matches)
        .where(sql`${matches.state} not in ('finished', 'archived')`);
      return rows.map((r) => r.id);
    },

    async archiveOldFinished(before: number) {
      await db
        .update(matches)
        .set({ state: "archived" })
        .where(and(eq(matches.state, "finished"), sql`coalesce(${matches.endedAt}, ${matches.createdAt}) < ${before}`));
    },
  };
}

export type Store = ReturnType<typeof createStore>;
