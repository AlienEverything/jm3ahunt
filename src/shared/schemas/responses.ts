// REST response shapes (SPEC §6). Server returns exactly these; the client types fetches with them.
import type { Avatar, GameMode, MatchResult, MatchState, PlayerStats, Role } from "../types";
import type { Settings } from "./settings";
import type { Zone } from "./zones";

export type GroupRole = "owner" | "admin" | "member";

export interface UserDto {
  id: string;
  displayName: string;
  /** null = guest (no username/password yet). */
  username: string | null;
  avatar: Avatar;
  stats: { matches: number; wins: number; captures: number; timesCaptured: number; rescues: number };
  createdAt: number;
}

export interface GroupSummaryDto {
  id: string;
  name: string;
  icon: string;
  myRole: GroupRole;
  memberCount: number;
  activeMatch: ActiveMatchDto | null;
}

export interface ActiveMatchDto {
  id: string;
  groupId: string;
  name: string;
  state: MatchState;
  playerCount: number;
  readyCount: number;
}

export interface MemberDto {
  userId: string;
  displayName: string;
  avatar: Avatar;
  role: GroupRole;
  joinedAt: number;
}

export interface PresetDto {
  id: string;
  groupId: string;
  kind: "game" | "zones";
  name: string;
  mode: GameMode;
  data: { settings: Settings } | { zones: Zone[] };
  createdBy: string;
  updatedAt: number;
}

export interface MatchSummaryDto {
  id: string;
  name: string;
  mode: GameMode;
  state: MatchState;
  createdAt: number;
  endedAt: number | null;
  /** Winner + duration only; never coordinates. */
  result: Pick<MatchResult, "winner" | "reason"> | null;
  durationSec: number | null;
  playerCount: number;
}

export interface GroupDetailDto {
  id: string;
  name: string;
  icon: string;
  ownerId: string;
  myRole: GroupRole;
  hasPassword: boolean;
  maxMembers: number;
  /** Only owner/admin receive codes. */
  joinCode: string | null;
  inviteToken: string | null;
  members: MemberDto[];
  currentMatch: ActiveMatchDto | null;
  recentMatches: MatchSummaryDto[];
  presets: PresetDto[];
  createdAt: number;
}

export interface InvitePreviewDto {
  groupId: string;
  groupName: string;
  icon: string;
  memberCount: number;
  needsPassword: boolean;
  alreadyMember: boolean;
}

/** GET /api/matches/:id — static lobby info; live state comes over WS (`view`). */
export interface MatchInfoDto {
  id: string;
  groupId: string;
  name: string;
  mode: GameMode;
  state: MatchState;
  hostId: string;
  settings: Settings;
  zones: Zone[];
  settingsHash: string;
  canManage: boolean;
  simulationAllowed: boolean;
  createdAt: number;
}

export interface ResultPlayerDto {
  userId: string;
  displayName: string;
  avatar: Avatar;
  finalRole: Role | null;
  stats: PlayerStats;
}

/** GET /api/matches/:id/results */
export interface MatchResultsDto {
  match: MatchSummaryDto & { groupId: string; startedAt: number | null };
  result: MatchResult;
  players: ResultPlayerDto[];
  /** Notable non-location events, already rendered as i18n keys by the client. */
  highlights: { at: number; type: string; payload: Record<string, string | number | boolean | null | string[]> }[];
}

export interface MeDto {
  user: UserDto;
  groups: GroupSummaryDto[];
  activeMatches: ActiveMatchDto[];
  recentResults: (MatchSummaryDto & { groupId: string; groupName: string })[];
}
