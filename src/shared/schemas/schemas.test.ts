import { describe, expect, it } from "vitest";
import { hasMessage } from "@/i18n";
import { MATCH_EVENT_TYPES } from "../types";
import { CreateMatchBody, CreatePresetBody, GuestBody, JoinGroupBody, RegisterBody } from "./api";
import { DEFAULT_SETTINGS } from "../defaults";
import { mainZone } from "../test-helpers";
import { MAX_WS_MESSAGE_BYTES, ServerMessageSchema, parseClientMessage } from "./ws";
import { ZoneSchema } from "./zones";

const ok = (m: unknown) => parseClientMessage(JSON.stringify(m));

describe("client WS messages", () => {
  it("accepts every message type", () => {
    const hash = "f".repeat(64);
    const op = "12345678-aaaa";
    const msgs = [
      { t: "hello", matchId: "m1", lastSeq: 4 },
      { t: "loc", lat: 24.7, lng: 46.6, acc: 8, ts: 1, speed: null },
      { t: "consent", accept: true, settingsHash: hash },
      { t: "consent", accept: false },
      { t: "ready", ready: true },
      { t: "host", opId: op, op: "start" },
      { t: "host", opId: op, op: "setRole", userId: "u", role: "seeker" },
      { t: "host", opId: op, op: "resolveCapture", captureId: "c", decision: "confirm" },
      { t: "emergency", opId: op },
      { t: "withdraw", opId: op },
      { t: "tag", opId: op, hiderId: "h" },
      { t: "tagReply", opId: op, captureId: "c", accept: false },
      { t: "qrToken" },
      { t: "qrScan", opId: op, token: "123456" },
      { t: "rescue", opId: op, jailedId: "j" },
      { t: "rescueReply", opId: op, rescuerId: "r", accept: true },
      { t: "hb" },
    ];
    for (const m of msgs) expect(ok(m), JSON.stringify(m)).toMatchObject({ ok: true });
  });

  it("rejects bad shapes, unknown keys, oversize and non-JSON", () => {
    expect(ok({ t: "consent", accept: true })).toMatchObject({ ok: false, error: "invalid" });
    expect(ok({ t: "loc", lat: 91, lng: 0, acc: 1, ts: 1 })).toMatchObject({ ok: false });
    expect(ok({ t: "hb", extra: 1 })).toMatchObject({ ok: false });
    expect(ok({ t: "host", opId: "12345678", op: "promoteMeToGod" })).toMatchObject({ ok: false });
    expect(ok({ t: "nope" })).toMatchObject({ ok: false });
    expect(parseClientMessage("{nope")).toEqual({ ok: false, error: "bad_json" });
    const big = JSON.stringify({ t: "hello", matchId: "x".repeat(MAX_WS_MESSAGE_BYTES) });
    expect(parseClientMessage(big)).toEqual({ ok: false, error: "too_large" });
    expect(parseClientMessage(new TextEncoder().encode(JSON.stringify({ t: "hb" })))).toMatchObject({ ok: true });
  });

  it("server messages parse", () => {
    expect(ServerMessageSchema.safeParse({ t: "welcome", serverNow: 1, userId: null }).success).toBe(true);
    expect(ServerMessageSchema.safeParse({ t: "prompt", kind: "tagRequest", captureId: "c", seekerName: "S", expiresAt: 1 }).success).toBe(true);
    expect(ServerMessageSchema.safeParse({ t: "qr", token: "x", code: "12345", expiresAt: 1 }).success).toBe(false);
  });
});

describe("REST bodies and zones", () => {
  it("validates bodies", () => {
    expect(GuestBody.parse({ displayName: "  Sam " }).displayName).toBe("Sam");
    expect(GuestBody.safeParse({ displayName: "" }).success).toBe(false);
    expect(RegisterBody.parse({ username: "Sam_1", password: "longenough" }).username).toBe("sam_1");
    expect(RegisterBody.safeParse({ username: "sa", password: "longenough" }).success).toBe(false);
    expect(JoinGroupBody.safeParse({ codeOrToken: "ABCD2345" }).success).toBe(true);
    expect(CreateMatchBody.safeParse({ name: "Park", presetId: "classic", settings: DEFAULT_SETTINGS }).success).toBe(false);
    expect(CreateMatchBody.safeParse({ name: "Park", settings: DEFAULT_SETTINGS, zones: [mainZone()] }).success).toBe(true);
    expect(CreatePresetBody.safeParse({ kind: "zones", name: "Park", mode: "hide_seek", data: { zones: [mainZone()] } }).success).toBe(true);
    expect(CreatePresetBody.safeParse({ kind: "game", name: "Park", mode: "hide_seek", data: { zones: [] } }).success).toBe(false);
  });

  it("zone schema enforces structure", () => {
    expect(ZoneSchema.safeParse(mainZone()).success).toBe(true);
    expect(ZoneSchema.safeParse({ ...mainZone(), color: "red" }).success).toBe(false);
    expect(ZoneSchema.safeParse({ ...mainZone(), shape: { kind: "circle", center: [200, 0], radiusM: 10 } }).success).toBe(false);
  });

  it("every event type has a message", () => {
    for (const e of MATCH_EVENT_TYPES) expect(hasMessage(`events.${e}`), e).toBe(true);
  });
});
