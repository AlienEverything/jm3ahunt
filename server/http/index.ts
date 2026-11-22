import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { SESSION_COOKIE, userForToken } from "../auth";
import type { AppContext } from "../context";
import { clientIp, originAllowed } from "../security/origin";
import { authRoutes } from "./auth";
import { groupRoutes } from "./groups";
import { matchRoutes } from "./matches";
import { HttpError, tooMany, type Env } from "./util";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** REST API mounted under /api (SPEC §6). */
export function createApi(ctx: AppContext) {
  const api = new Hono<Env>().basePath("/api");

  api.get("/health", (c) => c.json({ ok: true, time: ctx.now() }));

  api.use("*", async (c, next) => {
    c.set("ip", clientIp(c.req.raw.headers, c.env?.incoming?.socket?.remoteAddress));
    if (MUTATING.has(c.req.method) && !originAllowed(c.req.header("origin"), c.req.header("host"), ctx.config.appOrigin)) {
      throw new HttpError(403, "bad_origin", "Cross-site request refused");
    }
    const user = await userForToken(ctx.db, getCookie(c, SESSION_COOKIE), ctx.now());
    c.set("user", user);
    if (user && !ctx.limits.rest.take(`user:${user.id}`)) throw tooMany();
    await next();
  });

  api.route("/", authRoutes(ctx));
  api.route("/", groupRoutes(ctx));
  api.route("/", matchRoutes(ctx));

  api.notFound((c) => c.json({ error: { code: "not_found", message: "Not found" } }, 404));
  api.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: { code: err.code, message: err.message, ...(err.extra ?? {}) } }, err.status);
    console.error("[api]", err instanceof Error ? err.message : err);
    return c.json({ error: { code: "internal", message: "Internal error" } }, 500);
  });

  return api;
}
