import { z } from "zod";
import type { Issue, MatchEvent, MatchView } from "../types";
import { RoleSchema } from "./zones";

export const MAX_WS_MESSAGE_BYTES = 8 * 1024;

const Id = z.string().min(1).max(64);
/** Client-generated idempotency key (crypto.randomUUID()). */
const OpId = z.string().min(8).max(64);

const HostOpSchema = z.discriminatedUnion("op", [
  z.strictObject({ t: z.literal("host"), opId: OpId, op: z.literal("open") }),
  z.strictObject({ t: z.literal("host"), opId: OpId, op: z.literal("start") }),
  z.strictObject({ t: z.literal("host"), opId: OpId, op: z.literal("pause") }),
  z.strictObject({ t: z.literal("host"), opId: OpId, op: z.literal("resume") }),
  z.strictObject({ t: z.literal("host"), opId: OpId, op: z.literal("end") }),
  /** Manual assignment: re-roll randomly now (lobby). */
  z.strictObject({ t: z.literal("host"), opId: OpId, op: z.literal("assignRoles") }),
  z.strictObject({ t: z.literal("host"), opId: OpId, op: z.literal("setRole"), userId: Id, role: RoleSchema }),
  z.strictObject({ t: z.literal("host"), opId: OpId, op: z.literal("kick"), userId: Id }),
  z.strictObject({ t: z.literal("host"), opId: OpId, op: z.literal("resolveCapture"), captureId: Id, decision: z.enum(["confirm", "reject"]) }),
  /** Dev-only (simulation matches when ALLOW_SIM_GPS): server-side bot players, draft/lobby only. */
  z.strictObject({ t: z.literal("host"), opId: OpId, op: z.literal("addBot"), count: z.number().int().min(1).max(10).optional() }),
  z.strictObject({ t: z.literal("host"), opId: OpId, op: z.literal("removeBot"), userId: Id }),
]);

const ConsentSchema = z.discriminatedUnion("accept", [
  z.strictObject({ t: z.literal("consent"), accept: z.literal(true), settingsHash: z.string().regex(/^[0-9a-f]{64}$/) }),
  z.strictObject({ t: z.literal("consent"), accept: z.literal(false) }),
]);

export const ClientMessageSchema = z.discriminatedUnion("t", [
  z.strictObject({ t: z.literal("hello"), matchId: Id, lastSeq: z.number().int().min(0).optional() }),
  z.strictObject({
    t: z.literal("loc"),
    lat: z.number().finite().min(-90).max(90),
    lng: z.number().finite().min(-180).max(180),
    acc: z.number().finite().min(0).max(100_000),
    ts: z.number().int().min(0),
    speed: z.number().finite().min(0).max(1000).nullable().optional(),
    heading: z.number().finite().min(0).max(360).nullable().optional(),
    sim: z.boolean().optional(),
  }),
  ConsentSchema,
  z.strictObject({ t: z.literal("ready"), ready: z.boolean() }),
  HostOpSchema,
  z.strictObject({ t: z.literal("emergency"), opId: OpId }),
  z.strictObject({ t: z.literal("withdraw"), opId: OpId }),
  z.strictObject({ t: z.literal("tag"), opId: OpId, hiderId: Id }),
  z.strictObject({ t: z.literal("tagReply"), opId: OpId, captureId: Id, accept: z.boolean() }),
  z.strictObject({ t: z.literal("qrToken") }),
  z.strictObject({ t: z.literal("qrScan"), opId: OpId, token: z.string().min(6).max(512) }),
  z.strictObject({ t: z.literal("rescue"), opId: OpId, jailedId: Id }),
  /** Jailed player confirms or declines a `confirm`-method rescue. */
  z.strictObject({ t: z.literal("rescueReply"), opId: OpId, rescuerId: Id, accept: z.boolean() }),
  z.strictObject({ t: z.literal("hb") }),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;
export type ClientMessageType = ClientMessage["t"];
export type HostOp = z.infer<typeof HostOpSchema>;

export type ParseResult = { ok: true; msg: ClientMessage } | { ok: false; error: "too_large" | "bad_json" | "invalid"; detail?: string };

export const byteLength = (s: string) => new TextEncoder().encode(s).length;

/** Size cap → JSON → zod. Never throws. */
export function parseClientMessage(raw: string | Uint8Array): ParseResult {
  const size = typeof raw === "string" ? byteLength(raw) : raw.byteLength;
  if (size > MAX_WS_MESSAGE_BYTES) return { ok: false, error: "too_large" };
  let data: unknown;
  try {
    data = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
  } catch {
    return { ok: false, error: "bad_json" };
  }
  const r = ClientMessageSchema.safeParse(data);
  return r.success ? { ok: true, msg: r.data } : { ok: false, error: "invalid", detail: r.error.issues[0]?.message };
}

// ── server → client ─────────────────────────────────────────────────────────

const objectLike = (v: unknown) => typeof v === "object" && v !== null;

export const ServerMessageSchema = z.discriminatedUnion("t", [
  z.object({ t: z.literal("welcome"), serverNow: z.number(), userId: z.string().nullable() }),
  z.object({ t: z.literal("view"), v: z.custom<MatchView>(objectLike) }),
  z.object({ t: z.literal("event"), e: z.custom<MatchEvent>(objectLike) }),
  z.discriminatedUnion("kind", [
    /** `hint: "far"`: both fixes fresh and farther apart than the tag distance (GPS is never proof). Only the hider sees it. */
    z.object({ t: z.literal("prompt"), kind: z.literal("tagRequest"), captureId: z.string(), seekerName: z.string(), expiresAt: z.number(), hint: z.literal("far").optional() }),
    z.object({ t: z.literal("prompt"), kind: z.literal("rescueRequest"), rescuerId: z.string(), rescuerName: z.string(), expiresAt: z.number() }),
  ]),
  z.object({ t: z.literal("qr"), token: z.string(), code: z.string().regex(/^\d{6}$/), expiresAt: z.number() }),
  /** `issues`: preflight failures when `start` is refused (the match returns to lobby). */
  z.object({
    t: z.literal("ack"),
    opId: z.string(),
    ok: z.boolean(),
    error: z.string().optional(),
    key: z.string().optional(),
    issues: z.array(z.custom<Issue>(objectLike)).optional(),
  }),
  z.object({ t: z.literal("error"), code: z.string(), message: z.string() }),
  z.object({ t: z.literal("hbAck"), serverNow: z.number() }),
]);

export type ServerMessage = z.infer<typeof ServerMessageSchema>;
