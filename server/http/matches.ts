import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { nanoid } from "nanoid";
import {
  CreateMatchBody,
  DEFAULT_SETTINGS,
  PutSettingsBody,
  PutZonesBody,
  buildShrinkBehavior,
  emptyStats,
  getBuiltInPreset,
  settingsHash,
  validateSettings,
  validateZones,
  type MatchResultsDto,
  type Settings,
  type Zone,
} from "@/shared";
import type { AppContext } from "../context";
import { matchEvents, matches, matchPlayers, presets, users } from "../db/schema";
import { NON_TERMINAL, matchInfo, matchSummary, playerCounts, requireGroupManager, requireMatchAccess, requireMember } from "./dto";
import { HttpError, forbidden, notFound, readBody, requireUser, type C, type Env } from "./util";

const HIGHLIGHT_TYPES = ["capture.confirmed", "player.converted", "player.eliminated", "player.jailed", "player.rescued", "match.overtime", "match.emergency", "boundary.penalty", "match.finished"];

/** Cross-field errors block saving. Zone layouts are checked only once drawn; preflight checks everything. */
function configIssues(ctx: AppContext, settings: Settings, zones: Zone[]) {
  const issues = validateSettings(settings, { allowSimulation: ctx.config.allowSimGps });
  if (zones.length > 0) issues.push(...validateZones(zones, { durationMin: settings.timing.durationMin }));
  const errors = issues.filter((i) => i.severity === "error");
  if (errors.length) throw new HttpError(422, "invalid_settings", "Settings or zones have errors", { issues: errors });
}

export function matchRoutes(ctx: AppContext) {
  const r = new Hono<Env>();

  r.post("/groups/:id/matches", async (c) => {
    const me = requireUser(c);
    const { group } = await requireGroupManager(ctx, c.req.param("id"), me.id);
    const body = await readBody(c, CreateMatchBody);

    const live = await ctx.db.select({ id: matches.id }).from(matches).where(and(eq(matches.groupId, group.id), NON_TERMINAL)).get();
    if (live) throw new HttpError(409, "match_exists", "This group already has an open match");

    let settings: Settings = body.settings ?? DEFAULT_SETTINGS;
    let zones: Zone[] = body.zones ?? [];
    if (body.presetId) {
      const builtIn = getBuiltInPreset(body.presetId);
      if (builtIn) {
        settings = builtIn.settings;
        const main = zones.find((z) => z.enabled && z.type === "main");
        if (builtIn.mainShrink && main && main.behavior.kind === "static") {
          zones = zones.map((z) => (z === main ? { ...z, behavior: buildShrinkBehavior(z, builtIn.mainShrink!) } : z));
        }
      } else {
        const saved = await ctx.db.select().from(presets).where(and(eq(presets.id, body.presetId), eq(presets.groupId, group.id))).get();
        if (!saved) throw notFound("Preset not found");
        if ("settings" in saved.data) settings = saved.data.settings;
        else zones = saved.data.zones;
      }
    }
    configIssues(ctx, settings, zones);

    // Creating the next match archives the finished one.
    const finished = await ctx.db.select({ id: matches.id }).from(matches).where(and(eq(matches.groupId, group.id), eq(matches.state, "finished")));
    if (finished.length) {
      await ctx.db.update(matches).set({ state: "archived" }).where(inArray(matches.id, finished.map((f) => f.id)));
      for (const f of finished) ctx.registry.forget(f.id);
    }

    const now = ctx.now();
    const row = {
      id: nanoid(),
      groupId: group.id,
      name: body.name,
      mode: "hide_seek" as const,
      state: body.quickStart ? ("lobby" as const) : ("draft" as const),
      hostId: me.id,
      settings,
      zones,
      settingsHash: await settingsHash(settings, zones),
      createdAt: now,
      startedAt: null,
      endedAt: null,
      result: null,
      snapshot: null,
      version: 0,
    };
    await ctx.db.insert(matches).values(row);
    const rt = (await ctx.registry.get(row.id)) ?? undefined;
    return c.json(matchInfo(ctx, row, rt, true), 201);
  });

  r.get("/groups/:id/matches", async (c) => {
    const me = requireUser(c);
    const { group } = await requireMember(ctx, c.req.param("id"), me.id);
    const rows = await ctx.db
      .select()
      .from(matches)
      .where(and(eq(matches.groupId, group.id), inArray(matches.state, ["finished", "archived"])))
      .orderBy(desc(matches.createdAt))
      .limit(50);
    const counts = await playerCounts(ctx, rows.map((m) => m.id));
    return c.json(rows.map((m) => matchSummary(m, counts.get(m.id) ?? 0)));
  });

  r.get("/matches/:id", async (c) => {
    const me = requireUser(c);
    const { row, rt, canManage } = await requireMatchAccess(ctx, c.req.param("id"), me.id);
    return c.json(matchInfo(ctx, row, rt, canManage));
  });

  const putConfig = async (c: C, which: "settings" | "zones") => {
    const me = requireUser(c);
    const { row, rt, canManage } = await requireMatchAccess(ctx, c.req.param("id") ?? "", me.id);
    if (!canManage) throw forbidden("Only the host or a group admin can change the rules");
    if (!rt) throw new HttpError(409, "locked", "Settings are locked once the match has started");
    let settings = rt.settings;
    let zones = rt.zones;
    if (which === "settings") settings = (await readBody(c, PutSettingsBody)).settings;
    else zones = (await readBody(c, PutZonesBody)).zones;
    configIssues(ctx, settings, zones);
    const err = rt.updateConfig(settings, zones, await settingsHash(settings, zones));
    if (err) throw new HttpError(409, "locked", "Settings are locked once the match has started");
    return c.json(matchInfo(ctx, row, rt, canManage));
  };
  r.put("/matches/:id/settings", (c) => putConfig(c, "settings"));
  r.put("/matches/:id/zones", (c) => putConfig(c, "zones"));

  r.get("/matches/:id/results", async (c) => {
    const me = requireUser(c);
    const { row, rt } = await requireMatchAccess(ctx, c.req.param("id"), me.id);
    // A just-finished runtime may still be writing its final row.
    await rt?.flushWrites();
    const m = rt ? ((await ctx.db.select().from(matches).where(eq(matches.id, row.id)).get()) ?? row) : row;
    if (!m.result || (m.state !== "finished" && m.state !== "archived")) throw new HttpError(409, "not_finished", "The match has not finished");
    const players = await ctx.db
      .select({ p: matchPlayers, u: users })
      .from(matchPlayers)
      .innerJoin(users, eq(users.id, matchPlayers.userId))
      .where(eq(matchPlayers.matchId, m.id))
      .orderBy(asc(matchPlayers.joinedAt));
    const events = await ctx.db
      .select()
      .from(matchEvents)
      .where(and(eq(matchEvents.matchId, m.id), eq(matchEvents.audience, "all"), inArray(matchEvents.type, HIGHLIGHT_TYPES)))
      .orderBy(asc(matchEvents.seq))
      .limit(200);
    const result = m.result;
    const dto: MatchResultsDto = {
      match: { ...matchSummary(m, players.length), groupId: m.groupId, startedAt: m.startedAt },
      result,
      players: players.map(({ p, u }) => ({
        userId: u.id,
        displayName: u.displayName,
        avatar: { color: u.avatarColor, emoji: u.avatarEmoji },
        finalRole: p.role,
        stats: result.stats[u.id] ?? p.stats ?? emptyStats(),
      })),
      highlights: events.map((e) => ({ at: e.createdAt, type: e.type, payload: e.payload as MatchResultsDto["highlights"][number]["payload"] })),
    };
    return c.json(dto);
  });

  return r;
}
