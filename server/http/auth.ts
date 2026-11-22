import { and, desc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { nanoid } from "nanoid";
import { GuestBody, LoginBody, PatchMeBody, RegisterBody, type ActiveMatchDto, type GroupSummaryDto, type MeDto } from "@/shared";
import { SESSION_COOKIE, SESSION_TTL_MS, createSession, deleteSession, hashPassword, verifyPassword } from "../auth";
import type { AppContext } from "../context";
import { groupMembers, groups, matches, matchPlayers, users } from "../db/schema";
import { EMPTY_USER_STATS } from "../engine/store";
import { TERMINAL, currentMatch, matchSummary, memberCount, playerCounts, userDto } from "./dto";
import { HttpError, readBody, requireUser, tooMany, type C, type Env } from "./util";

const AVATAR_COLORS = ["#FF5A1F", "#0EA5A4", "#6366F1", "#EAB308", "#EC4899", "#22C55E", "#3B82F6", "#A855F7"];
const AVATAR_EMOJIS = ["🦊", "🐺", "🦉", "🐢", "🦅", "🐙", "🐯", "🦔", "🐸", "🐼"];
const pick = <T>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)];
// bcrypt of a random string: keeps login timing equal for unknown usernames.
let dummyHash: Promise<string> | null = null;

function secureRequest(c: C, ctx: AppContext) {
  if (!ctx.config.isProduction) return false;
  const proto = c.req.header("x-forwarded-proto")?.split(",")[0]?.trim() ?? new URL(c.req.url).protocol.replace(":", "");
  return proto === "https";
}

function setSessionCookie(c: C, ctx: AppContext, token: string) {
  setCookie(c, SESSION_COOKIE, token, { httpOnly: true, sameSite: "Lax", secure: secureRequest(c, ctx), path: "/", maxAge: Math.floor(SESSION_TTL_MS / 1000) });
}

export async function groupSummaries(ctx: AppContext, userId: string): Promise<GroupSummaryDto[]> {
  const rows = await ctx.db
    .select({ g: groups, role: groupMembers.role })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(eq(groupMembers.userId, userId))
    .orderBy(groupMembers.joinedAt);
  return Promise.all(
    rows.map(async ({ g, role }) => ({
      id: g.id,
      name: g.name,
      icon: g.icon,
      myRole: role,
      memberCount: await memberCount(ctx, g.id),
      activeMatch: await currentMatch(ctx, g.id, userId, role),
    })),
  );
}

export function authRoutes(ctx: AppContext) {
  const r = new Hono<Env>();

  r.post("/auth/guest", async (c) => {
    if (!ctx.limits.auth.take(`ip:${c.get("ip")}`)) throw tooMany();
    const body = await readBody(c, GuestBody);
    const now = ctx.now();
    const user = { id: nanoid(), displayName: body.displayName, username: null, passwordHash: null, avatarColor: pick(AVATAR_COLORS), avatarEmoji: pick(AVATAR_EMOJIS), createdAt: now, stats: EMPTY_USER_STATS };
    await ctx.db.insert(users).values(user);
    setSessionCookie(c, ctx, await createSession(ctx.db, user.id, now));
    return c.json({ user: userDto(user) }, 201);
  });

  r.post("/auth/register", async (c) => {
    if (!ctx.limits.auth.take(`ip:${c.get("ip")}`)) throw tooMany();
    const me = requireUser(c);
    const body = await readBody(c, RegisterBody);
    if (me.username) throw new HttpError(409, "already_registered", "This account already has a username");
    const taken = await ctx.db.select({ id: users.id }).from(users).where(eq(users.username, body.username)).get();
    if (taken) throw new HttpError(409, "username_taken", "That username is taken");
    const passwordHash = await hashPassword(body.password);
    await ctx.db.update(users).set({ username: body.username, passwordHash }).where(eq(users.id, me.id));
    return c.json({ user: userDto({ ...me, username: body.username, passwordHash }) });
  });

  r.post("/auth/login", async (c) => {
    if (!ctx.limits.auth.take(`ip:${c.get("ip")}`)) throw tooMany();
    const body = await readBody(c, LoginBody);
    const user = await ctx.db.select().from(users).where(eq(users.username, body.username)).get();
    dummyHash ??= hashPassword(nanoid());
    const ok = await verifyPassword(body.password, user?.passwordHash ?? (await dummyHash));
    if (!user?.passwordHash || !ok) throw new HttpError(401, "invalid_credentials", "Wrong username or password");
    const old = getCookie(c, SESSION_COOKIE);
    if (old) await deleteSession(ctx.db, old);
    setSessionCookie(c, ctx, await createSession(ctx.db, user.id, ctx.now()));
    return c.json({ user: userDto(user) });
  });

  r.post("/auth/logout", async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) await deleteSession(ctx.db, token);
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  r.get("/me", async (c) => {
    const me = requireUser(c);
    const groupsList = await groupSummaries(ctx, me.id);
    const activeMatches = groupsList.map((g) => g.activeMatch).filter((m): m is ActiveMatchDto => !!m);
    const played = await ctx.db
      .select({ m: matches, groupName: groups.name })
      .from(matchPlayers)
      .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
      .innerJoin(groups, eq(groups.id, matches.groupId))
      .where(and(eq(matchPlayers.userId, me.id), TERMINAL, inArray(matches.groupId, groupsList.length ? groupsList.map((g) => g.id) : [""])))
      .orderBy(desc(matches.endedAt))
      .limit(10);
    const counts = await playerCounts(ctx, played.map((p) => p.m.id));
    const dto: MeDto = {
      user: userDto(me),
      groups: groupsList,
      activeMatches,
      recentResults: played.map(({ m, groupName }) => ({ ...matchSummary(m, counts.get(m.id) ?? 0), groupId: m.groupId, groupName })),
    };
    return c.json(dto);
  });

  r.patch("/me", async (c) => {
    const me = requireUser(c);
    const body = await readBody(c, PatchMeBody);
    const patch = {
      ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
      ...(body.avatarColor !== undefined ? { avatarColor: body.avatarColor } : {}),
      ...(body.avatarEmoji !== undefined ? { avatarEmoji: body.avatarEmoji } : {}),
    };
    if (Object.keys(patch).length) await ctx.db.update(users).set(patch).where(eq(users.id, me.id));
    return c.json({ user: userDto({ ...me, ...patch }) });
  });

  return r;
}
