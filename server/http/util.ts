import type { HttpBindings } from "@hono/node-server";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { z } from "zod";
import type { SessionUser } from "../auth";

export type Env = { Bindings: HttpBindings; Variables: { user: SessionUser | null; ip: string } };
export type C = Context<Env>;

/** Thrown by routes; rendered as {error: {code, message}}. */
export class HttpError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
    readonly extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const notFound = (what = "Not found") => new HttpError(404, "not_found", what);
export const forbidden = (message = "Not allowed") => new HttpError(403, "forbidden", message);
export const tooMany = () => new HttpError(429, "rate_limited", "Too many attempts, try again in a minute");

export async function readBody<S extends z.ZodType>(c: C, schema: S): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new HttpError(400, "bad_json", "Body must be JSON");
  }
  const r = schema.safeParse(raw);
  if (!r.success) {
    const i = r.error.issues[0];
    throw new HttpError(400, "invalid_body", `${i?.path.join(".") || "body"}: ${i?.message ?? "invalid"}`);
  }
  return r.data;
}

export function requireUser(c: C): SessionUser {
  const u = c.get("user");
  if (!u) throw new HttpError(401, "unauthorized", "Sign in first");
  return u;
}

