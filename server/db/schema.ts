// Drizzle schema (SPEC §4). After editing: `npm run db:generate`. Never store coordinates here.
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { MatchResult, MatchState, PlayerStats, PlayerStatus, Role, Settings, Zone } from "@/shared";

export interface UserStats {
  matches: number;
  wins: number;
  captures: number;
  timesCaptured: number;
  rescues: number;
}

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  username: text("username").unique(),
  passwordHash: text("password_hash"),
  avatarColor: text("avatar_color").notNull(),
  avatarEmoji: text("avatar_emoji").notNull(),
  createdAt: integer("created_at").notNull(),
  stats: text("stats_json", { mode: "json" }).$type<UserStats>().notNull(),
});

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const groups = sqliteTable("groups", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  icon: text("icon").notNull(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id),
  joinCode: text("join_code").notNull().unique(),
  inviteToken: text("invite_token").notNull().unique(),
  passwordHash: text("password_hash"),
  maxMembers: integer("max_members").notNull().default(15),
  settings: text("settings_json", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  createdAt: integer("created_at").notNull(),
});

export type GroupRole = "owner" | "admin" | "member";

export const groupMembers = sqliteTable(
  "group_members",
  {
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<GroupRole>().notNull(),
    joinedAt: integer("joined_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.userId] }), index("group_members_user_idx").on(t.userId)],
);

export const presets = sqliteTable(
  "presets",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"game" | "zones">().notNull(),
    name: text("name").notNull(),
    mode: text("mode").$type<"hide_seek">().notNull(),
    data: text("data_json", { mode: "json" }).$type<{ settings: Settings } | { zones: Zone[] }>().notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("presets_group_idx").on(t.groupId)],
);

export const matches = sqliteTable(
  "matches",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    mode: text("mode").$type<"hide_seek">().notNull(),
    state: text("state").$type<MatchState>().notNull(),
    hostId: text("host_id").notNull(),
    settings: text("settings_json", { mode: "json" }).$type<Settings>().notNull(),
    zones: text("zones_json", { mode: "json" }).$type<Zone[]>().notNull(),
    settingsHash: text("settings_hash").notNull(),
    createdAt: integer("created_at").notNull(),
    startedAt: integer("started_at"),
    endedAt: integer("ended_at"),
    result: text("result_json", { mode: "json" }).$type<MatchResult>(),
    /** Crash-recovery state. Never contains locations. */
    snapshot: text("snapshot_json", { mode: "json" }).$type<Record<string, unknown>>(),
    version: integer("version").notNull().default(0),
  },
  (t) => [index("matches_group_state_idx").on(t.groupId, t.state)],
);

export const matchPlayers = sqliteTable(
  "match_players",
  {
    matchId: text("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<Role>(),
    team: text("team"),
    status: text("status").$type<PlayerStatus>().notNull(),
    ready: integer("ready", { mode: "boolean" }).notNull().default(false),
    consentHash: text("consent_hash"),
    joinedAt: integer("joined_at").notNull(),
    leftAt: integer("left_at"),
    stats: text("stats_json", { mode: "json" }).$type<PlayerStats>(),
    /** Dev-only simulated player. */
    isBot: integer("is_bot", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.matchId, t.userId] }), index("match_players_user_idx").on(t.userId)],
);

export const matchEvents = sqliteTable(
  "match_events",
  {
    id: text("id").primaryKey(),
    matchId: text("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    type: text("type").notNull(),
    actorId: text("actor_id"),
    /** Never coordinates. */
    payload: text("payload_json", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    audience: text("audience").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("match_events_seq_idx").on(t.matchId, t.seq)],
);

export const captures = sqliteTable(
  "captures",
  {
    id: text("id").primaryKey(),
    matchId: text("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    seekerId: text("seeker_id").notNull(),
    hiderId: text("hider_id").notNull(),
    method: text("method").$type<"mutual" | "qr" | "code">().notNull(),
    status: text("status").$type<"pending" | "confirmed" | "disputed" | "rejected" | "expired">().notNull(),
    createdAt: integer("created_at").notNull(),
    resolvedAt: integer("resolved_at"),
    resolvedBy: text("resolved_by"),
  },
  (t) => [index("captures_match_idx").on(t.matchId)],
);
