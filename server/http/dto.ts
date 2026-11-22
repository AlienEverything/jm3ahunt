import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import type { ActiveMatchDto, GroupRole, MatchInfoDto, MatchSummaryDto, MemberDto, PresetDto, UserDto } from "@/shared";
import type { AppContext } from "../context";
import { groupMembers, groups, matches, matchPlayers, presets, users } from "../db/schema";
import type { MatchRuntime } from "../engine/runtime";
import { EMPTY_USER_STATS, type MatchRow } from "../engine/store";
import { forbidden, notFound } from "./util";

export const NON_TERMINAL = sql`${matches.state} not in ('finished', 'archived')`;
export const TERMINAL = sql`${matches.state} in ('finished', 'archived')`;

export const userDto = (u: typeof users.$inferSelect): UserDto => ({
  id: u.id,
  displayName: u.displayName,
  username: u.username,
  avatar: { color: u.avatarColor, emoji: u.avatarEmoji },
  stats: { ...EMPTY_USER_STATS, ...u.stats },
  createdAt: u.createdAt,
});

export const presetDto = (p: typeof presets.$inferSelect): PresetDto => ({
  id: p.id,
  groupId: p.groupId,
  kind: p.kind,
  name: p.name,
  mode: p.mode,
  data: p.data,
  createdBy: p.createdBy,
  updatedAt: p.updatedAt,
});

export const canManageGroup = (role: GroupRole | null) => role === "owner" || role === "admin";

export async function membership(ctx: AppContext, groupId: string, userId: string): Promise<GroupRole | null> {
  const row = await ctx.db
    .select({ role: groupMembers.role })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
    .get();
  return row?.role ?? null;
}

/** Group + caller role; 404 for unknown groups, 403 for non-members. */
export async function requireMember(ctx: AppContext, groupId: string, userId: string) {
  const group = await ctx.db.select().from(groups).where(eq(groups.id, groupId)).get();
  if (!group) throw notFound("Group not found");
  const role = await membership(ctx, groupId, userId);
  if (!role) throw forbidden("You are not a member of this group");
  return { group, role };
}

export async function requireGroupManager(ctx: AppContext, groupId: string, userId: string) {
  const m = await requireMember(ctx, groupId, userId);
  if (!canManageGroup(m.role)) throw forbidden("Only the group owner or an admin can do this");
  return m;
}

/** Match row + live runtime + caller's rights. Drafts are hidden from non-managers. */
export async function requireMatchAccess(ctx: AppContext, matchId: string, userId: string) {
  const row = await ctx.db.select().from(matches).where(eq(matches.id, matchId)).get();
  if (!row) throw notFound("Match not found");
  const role = await membership(ctx, row.groupId, userId);
  if (!role) throw forbidden("You are not a member of this group");
  const canManage = canManageGroup(role) || row.hostId === userId;
  const rt = ctx.registry.peek(matchId) ?? (row.state === "finished" || row.state === "archived" ? undefined : ((await ctx.registry.get(matchId)) ?? undefined));
  if ((rt?.state ?? row.state) === "draft" && !canManage) throw notFound("Match not found");
  return { row, rt, canManage, role };
}

export function matchInfo(ctx: AppContext, row: MatchRow, rt: MatchRuntime | undefined, canManage: boolean): MatchInfoDto {
  return {
    id: row.id,
    groupId: row.groupId,
    name: rt?.name ?? row.name,
    mode: row.mode,
    state: rt?.state ?? row.state,
    hostId: rt?.hostId ?? row.hostId,
    settings: rt?.settings ?? row.settings,
    zones: rt?.zones ?? row.zones,
    settingsHash: rt?.settingsHash ?? row.settingsHash,
    canManage,
    simulationAllowed: ctx.config.allowSimGps,
    createdAt: row.createdAt,
  };
}

export function activeMatchFromRuntime(rt: MatchRuntime): ActiveMatchDto {
  const players = rt.activePlayers();
  return { id: rt.id, groupId: rt.groupId, name: rt.name, state: rt.state, playerCount: players.length, readyCount: players.filter((p) => p.ready).length };
}

/** The group's non-terminal match, hidden while in draft unless the caller manages it. */
export async function currentMatch(ctx: AppContext, groupId: string, userId: string, role: GroupRole): Promise<ActiveMatchDto | null> {
  const row = await ctx.db.select({ id: matches.id }).from(matches).where(and(eq(matches.groupId, groupId), NON_TERMINAL)).get();
  if (!row) return null;
  const rt = await ctx.registry.get(row.id);
  if (!rt) return null;
  if (rt.state === "draft" && !(canManageGroup(role) || rt.hostId === userId)) return null;
  return activeMatchFromRuntime(rt);
}

export async function playerCounts(ctx: AppContext, matchIds: string[]): Promise<Map<string, number>> {
  if (matchIds.length === 0) return new Map();
  const rows = await ctx.db
    .select({ matchId: matchPlayers.matchId, n: count() })
    .from(matchPlayers)
    .where(inArray(matchPlayers.matchId, matchIds))
    .groupBy(matchPlayers.matchId);
  return new Map(rows.map((r) => [r.matchId, r.n]));
}

export function matchSummary(row: MatchRow, playerCount: number): MatchSummaryDto {
  return {
    id: row.id,
    name: row.name,
    mode: row.mode,
    state: row.state,
    createdAt: row.createdAt,
    endedAt: row.endedAt,
    result: row.result ? { winner: row.result.winner, reason: row.result.reason } : null,
    durationSec: row.startedAt && row.endedAt ? Math.round((row.endedAt - row.startedAt) / 1000) : null,
    playerCount,
  };
}

export async function recentMatches(ctx: AppContext, groupId: string, limit = 10): Promise<MatchSummaryDto[]> {
  const rows = await ctx.db.select().from(matches).where(and(eq(matches.groupId, groupId), TERMINAL)).orderBy(desc(matches.createdAt)).limit(limit);
  const counts = await playerCounts(ctx, rows.map((r) => r.id));
  return rows.map((r) => matchSummary(r, counts.get(r.id) ?? 0));
}

export async function members(ctx: AppContext, groupId: string): Promise<MemberDto[]> {
  const rows = await ctx.db
    .select({ m: groupMembers, u: users })
    .from(groupMembers)
    .innerJoin(users, eq(users.id, groupMembers.userId))
    .where(eq(groupMembers.groupId, groupId))
    .orderBy(groupMembers.joinedAt);
  return rows.map(({ m, u }) => ({ userId: u.id, displayName: u.displayName, avatar: { color: u.avatarColor, emoji: u.avatarEmoji }, role: m.role, joinedAt: m.joinedAt }));
}

export async function memberCount(ctx: AppContext, groupId: string): Promise<number> {
  const r = await ctx.db.select({ n: count() }).from(groupMembers).where(eq(groupMembers.groupId, groupId)).get();
  return r?.n ?? 0;
}
