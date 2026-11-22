import { randomBytes } from "node:crypto";
import { and, asc, eq, ne } from "drizzle-orm";
import { Hono } from "hono";
import { nanoid } from "nanoid";
import {
  CreateGroupBody,
  CreatePresetBody,
  JoinGroupBody,
  PatchGroupBody,
  PatchPresetBody,
  SetMemberRoleBody,
  SettingsSchema,
  ZonesSchema,
  type GroupDetailDto,
  type GroupRole,
  type InvitePreviewDto,
} from "@/shared";
import { hashPassword, verifyPassword } from "../auth";
import { groupSummaries } from "./auth";
import type { AppContext } from "../context";
import { groupMembers, groups, presets } from "../db/schema";
import { canManageGroup, currentMatch, memberCount, members, membership, presetDto, recentMatches, requireGroupManager, requireMember } from "./dto";
import { HttpError, forbidden, notFound, readBody, requireUser, tooMany, type Env } from "./util";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** 8 chars of Crockford base32 (40 bits). */
export const newJoinCode = () => Array.from(randomBytes(8), (b) => CROCKFORD[b & 31]).join("");
/** 128-bit invite token, 22 chars base64url. */
export const newInviteToken = () => randomBytes(16).toString("base64url");
/** Crockford decoding is forgiving: case-insensitive, I/L→1, O→0, hyphens and spaces ignored. */
export const normalizeCode = (s: string) => s.toUpperCase().replace(/[\s-]/g, "").replace(/[IL]/g, "1").replace(/O/g, "0");

type GroupRow = typeof groups.$inferSelect;

async function groupDetail(ctx: AppContext, g: GroupRow, userId: string, role: GroupRole): Promise<GroupDetailDto> {
  const manage = canManageGroup(role);
  const presetRows = await ctx.db.select().from(presets).where(eq(presets.groupId, g.id)).orderBy(asc(presets.createdAt));
  return {
    id: g.id,
    name: g.name,
    icon: g.icon,
    ownerId: g.ownerId,
    myRole: role,
    hasPassword: !!g.passwordHash,
    maxMembers: g.maxMembers,
    joinCode: manage ? g.joinCode : null,
    inviteToken: manage ? g.inviteToken : null,
    members: await members(ctx, g.id),
    currentMatch: await currentMatch(ctx, g.id, userId, role),
    recentMatches: await recentMatches(ctx, g.id),
    presets: presetRows.map(presetDto),
    createdAt: g.createdAt,
  };
}

async function findByCodeOrToken(ctx: AppContext, codeOrToken: string) {
  const code = normalizeCode(codeOrToken);
  if (/^[0-9A-HJKMNP-TV-Z]{8}$/.test(code)) return ctx.db.select().from(groups).where(eq(groups.joinCode, code)).get();
  return ctx.db.select().from(groups).where(eq(groups.inviteToken, codeOrToken.trim())).get();
}

async function requirePresetManager(ctx: AppContext, presetId: string, userId: string) {
  const p = await ctx.db.select().from(presets).where(eq(presets.id, presetId)).get();
  if (!p) throw notFound("Preset not found");
  await requireGroupManager(ctx, p.groupId, userId);
  return p;
}

export function groupRoutes(ctx: AppContext) {
  const r = new Hono<Env>();

  r.get("/groups", async (c) => {
    const me = requireUser(c);
    return c.json(await groupSummaries(ctx, me.id));
  });

  r.post("/groups", async (c) => {
    const me = requireUser(c);
    const body = await readBody(c, CreateGroupBody);
    const now = ctx.now();
    const g: GroupRow = {
      id: nanoid(),
      name: body.name,
      icon: body.icon,
      ownerId: me.id,
      joinCode: newJoinCode(),
      inviteToken: newInviteToken(),
      passwordHash: body.password ? await hashPassword(body.password) : null,
      maxMembers: body.maxMembers ?? 15,
      settings: {},
      createdAt: now,
    };
    await ctx.db.batch([ctx.db.insert(groups).values(g), ctx.db.insert(groupMembers).values({ groupId: g.id, userId: me.id, role: "owner", joinedAt: now })]);
    return c.json(await groupDetail(ctx, g, me.id, "owner"), 201);
  });

  r.post("/groups/join", async (c) => {
    const me = requireUser(c);
    if (!ctx.limits.join.take(`ip:${c.get("ip")}`) || !ctx.limits.join.take(`user:${me.id}`)) throw tooMany();
    const body = await readBody(c, JoinGroupBody);
    const g = await findByCodeOrToken(ctx, body.codeOrToken);
    if (!g) throw notFound("No group with that code or link");
    let role = await membership(ctx, g.id, me.id);
    if (!role) {
      if (g.passwordHash && !(body.password && (await verifyPassword(body.password, g.passwordHash)))) {
        throw new HttpError(403, "wrong_password", "Wrong group password");
      }
      if ((await memberCount(ctx, g.id)) >= g.maxMembers) throw new HttpError(409, "group_full", "This group is full");
      await ctx.db.insert(groupMembers).values({ groupId: g.id, userId: me.id, role: "member", joinedAt: ctx.now() });
      role = "member";
    }
    return c.json({ id: g.id, name: g.name, icon: g.icon, myRole: role, memberCount: await memberCount(ctx, g.id), activeMatch: await currentMatch(ctx, g.id, me.id, role) });
  });

  r.get("/invite/:token", async (c) => {
    if (!ctx.limits.join.take(`ip:${c.get("ip")}`)) throw tooMany();
    const g = await findByCodeOrToken(ctx, c.req.param("token"));
    if (!g) throw notFound("Invite not found");
    const me = c.get("user");
    const dto: InvitePreviewDto = {
      groupId: g.id,
      groupName: g.name,
      icon: g.icon,
      memberCount: await memberCount(ctx, g.id),
      needsPassword: !!g.passwordHash,
      alreadyMember: me ? !!(await membership(ctx, g.id, me.id)) : false,
    };
    return c.json(dto);
  });

  r.get("/groups/:id", async (c) => {
    const me = requireUser(c);
    const { group, role } = await requireMember(ctx, c.req.param("id"), me.id);
    return c.json(await groupDetail(ctx, group, me.id, role));
  });

  r.patch("/groups/:id", async (c) => {
    const me = requireUser(c);
    const { group, role } = await requireGroupManager(ctx, c.req.param("id"), me.id);
    const body = await readBody(c, PatchGroupBody);
    const patch: Partial<GroupRow> = {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.icon !== undefined ? { icon: body.icon } : {}),
      ...(body.maxMembers !== undefined ? { maxMembers: body.maxMembers } : {}),
      ...(body.password !== undefined ? { passwordHash: body.password === null ? null : await hashPassword(body.password) } : {}),
    };
    if (Object.keys(patch).length) await ctx.db.update(groups).set(patch).where(eq(groups.id, group.id));
    return c.json(await groupDetail(ctx, { ...group, ...patch }, me.id, role));
  });

  r.post("/groups/:id/regenerate-codes", async (c) => {
    const me = requireUser(c);
    const { group, role } = await requireGroupManager(ctx, c.req.param("id"), me.id);
    const patch = { joinCode: newJoinCode(), inviteToken: newInviteToken() };
    await ctx.db.update(groups).set(patch).where(eq(groups.id, group.id));
    return c.json(await groupDetail(ctx, { ...group, ...patch }, me.id, role));
  });

  r.put("/groups/:id/members/:userId", async (c) => {
    const me = requireUser(c);
    const { group, role } = await requireMember(ctx, c.req.param("id"), me.id);
    if (role !== "owner") throw forbidden("Only the owner can change roles");
    const body = await readBody(c, SetMemberRoleBody);
    const target = c.req.param("userId");
    const cur = await membership(ctx, group.id, target);
    if (!cur) throw notFound("Member not found");
    if (cur === "owner") throw new HttpError(409, "owner_role", "The owner's role cannot be changed");
    await ctx.db.update(groupMembers).set({ role: body.role }).where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.userId, target)));
    const m = (await members(ctx, group.id)).find((x) => x.userId === target);
    return c.json(m);
  });

  r.delete("/groups/:id/members/:userId", async (c) => {
    const me = requireUser(c);
    const { group, role } = await requireGroupManager(ctx, c.req.param("id"), me.id);
    const target = c.req.param("userId");
    const cur = await membership(ctx, group.id, target);
    if (!cur) throw notFound("Member not found");
    if (target === me.id) throw new HttpError(409, "use_leave", "Use leave to leave the group");
    if (cur === "owner" || (cur === "admin" && role !== "owner")) throw forbidden("You cannot remove this member");
    await ctx.db.delete(groupMembers).where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.userId, target)));
    return c.json({ ok: true });
  });

  r.post("/groups/:id/leave", async (c) => {
    const me = requireUser(c);
    const { group, role } = await requireMember(ctx, c.req.param("id"), me.id);
    await ctx.db.delete(groupMembers).where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.userId, me.id)));
    if (role === "owner") {
      // Hand the group to the longest-standing admin, else the longest-standing member.
      const rest = await ctx.db.select().from(groupMembers).where(and(eq(groupMembers.groupId, group.id), ne(groupMembers.userId, me.id))).orderBy(asc(groupMembers.joinedAt));
      const heir = rest.find((m) => m.role === "admin") ?? rest[0];
      if (!heir) await ctx.db.delete(groups).where(eq(groups.id, group.id));
      else {
        await ctx.db.update(groupMembers).set({ role: "owner" }).where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.userId, heir.userId)));
        await ctx.db.update(groups).set({ ownerId: heir.userId }).where(eq(groups.id, group.id));
      }
    }
    return c.json({ ok: true });
  });

  // ── presets ───────────────────────────────────────────────────────────────

  r.get("/groups/:id/presets", async (c) => {
    const me = requireUser(c);
    const { group } = await requireMember(ctx, c.req.param("id"), me.id);
    const rows = await ctx.db.select().from(presets).where(eq(presets.groupId, group.id)).orderBy(asc(presets.createdAt));
    return c.json(rows.map(presetDto));
  });

  r.post("/groups/:id/presets", async (c) => {
    const me = requireUser(c);
    const { group } = await requireGroupManager(ctx, c.req.param("id"), me.id);
    const body = await readBody(c, CreatePresetBody);
    const now = ctx.now();
    const row = { id: nanoid(), groupId: group.id, kind: body.kind, name: body.name, mode: body.mode, data: body.data, createdBy: me.id, createdAt: now, updatedAt: now };
    await ctx.db.insert(presets).values(row);
    return c.json(presetDto(row), 201);
  });

  r.patch("/presets/:id", async (c) => {
    const me = requireUser(c);
    const p = await requirePresetManager(ctx, c.req.param("id"), me.id);
    const body = await readBody(c, PatchPresetBody);
    if (body.data) {
      const ok = p.kind === "game" ? "settings" in body.data && SettingsSchema.safeParse(body.data.settings).success : "zones" in body.data && ZonesSchema.safeParse(body.data.zones).success;
      if (!ok) throw new HttpError(400, "invalid_body", `data must match the preset kind (${p.kind})`);
    }
    const patch = { ...(body.name !== undefined ? { name: body.name } : {}), ...(body.data ? { data: body.data } : {}), updatedAt: ctx.now() };
    await ctx.db.update(presets).set(patch).where(eq(presets.id, p.id));
    return c.json(presetDto({ ...p, ...patch }));
  });

  r.delete("/presets/:id", async (c) => {
    const me = requireUser(c);
    const p = await requirePresetManager(ctx, c.req.param("id"), me.id);
    await ctx.db.delete(presets).where(eq(presets.id, p.id));
    return c.json({ ok: true });
  });

  r.post("/presets/:id/duplicate", async (c) => {
    const me = requireUser(c);
    const p = await requirePresetManager(ctx, c.req.param("id"), me.id);
    const now = ctx.now();
    const row = { ...p, id: nanoid(), name: `${p.name} copy`.slice(0, 40), createdBy: me.id, createdAt: now, updatedAt: now };
    await ctx.db.insert(presets).values(row);
    return c.json(presetDto(row), 201);
  });

  return r;
}
