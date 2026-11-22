import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { MAX_WS_MESSAGE_BYTES, parseClientMessage, type ServerMessage } from "@/shared";
import { SESSION_COOKIE, userForToken, type SessionUser } from "../auth";
import type { AppContext } from "../context";
import type { MatchRuntime, RtClient } from "../engine/runtime";
import { canManageGroup, membership } from "../http/dto";
import { originAllowed, parseCookies } from "../security/origin";

/** Sockets silent this long (no messages, no pongs) are closed. */
const IDLE_MS = 60_000;

interface Conn {
  ws: WebSocket;
  user: SessionUser;
  sub: { rt: MatchRuntime; client: RtClient } | null;
  chain: Promise<void>;
  seenAt: number;
}

function refuse(socket: Duplex, status: number, text: string) {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

/** WebSocket gateway on /ws (SPEC §7): cookie auth + Origin check on upgrade, one match per socket. */
export function createWsGateway(ctx: AppContext) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_WS_MESSAGE_BYTES });
  const conns = new Set<Conn>();

  const send = (ws: WebSocket, msg: ServerMessage) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };
  const error = (ws: WebSocket, code: string, message: string) => send(ws, { t: "error", code, message });

  const unsubscribe = (conn: Conn) => {
    if (!conn.sub) return;
    conn.sub.rt.detach(conn.sub.client);
    conn.sub = null;
  };

  async function hello(conn: Conn, matchId: string, lastSeq: number | undefined) {
    const rt = await ctx.registry.get(matchId);
    if (!rt) return error(conn.ws, "not_found", "Match not found");
    // Membership is re-checked from the DB on every hello (reconnects included).
    const role = await membership(ctx, rt.groupId, conn.user.id);
    if (!role) return error(conn.ws, "forbidden", "You are not a member of this group");
    const canManage = canManageGroup(role);
    if (rt.state === "draft" && !(canManage || rt.hostId === conn.user.id)) return error(conn.ws, "not_found", "Match not found");
    if (conn.ws.readyState !== WebSocket.OPEN) return;
    unsubscribe(conn);
    const client: RtClient = {
      userId: conn.user.id,
      name: conn.user.displayName,
      avatar: { color: conn.user.avatarColor, emoji: conn.user.avatarEmoji },
      canManage,
      send: (m) => send(conn.ws, m),
      lastViewAt: 0,
      dirty: true,
    };
    conn.sub = { rt, client };
    rt.attach(client, lastSeq);
  }

  async function onMessage(conn: Conn, raw: Buffer) {
    const parsed = parseClientMessage(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength));
    if (!parsed.ok) return error(conn.ws, parsed.error, parsed.detail ?? parsed.error);
    const msg = parsed.msg;
    if (msg.t === "hb") return send(conn.ws, { t: "hbAck", serverNow: ctx.now() });
    if (msg.t === "hello") return hello(conn, msg.matchId, msg.lastSeq);
    if (!conn.sub) return error(conn.ws, "no_match", "Send hello first");
    const { rt, client } = conn.sub;
    // Host rights follow the current DB role, so a demoted or removed admin loses them at once.
    if (msg.t === "host") {
      const role = await membership(ctx, rt.groupId, conn.user.id);
      // Removed from the group: no host powers, even as the match creator.
      if (!role) return send(conn.ws, { t: "ack", opId: msg.opId, ok: false, error: "forbidden", key: "errors.notHost" });
      client.canManage = canManageGroup(role);
    }
    rt.handle(client, msg);
  }

  wss.on("connection", (ws: WebSocket, _req: IncomingMessage, user: SessionUser) => {
    const conn: Conn = { ws, user, sub: null, chain: Promise.resolve(), seenAt: Date.now() };
    conns.add(conn);
    send(ws, { t: "welcome", serverNow: ctx.now(), userId: user.id });
    ws.on("message", (data: Buffer | ArrayBuffer | Buffer[]) => {
      conn.seenAt = Date.now();
      const raw = Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      // Messages of one socket are handled strictly in order (hello is async).
      conn.chain = conn.chain
        .then(() => onMessage(conn, raw))
        .catch((err: unknown) => {
          console.error("[ws] message failed:", err instanceof Error ? err.message : err);
          error(ws, "internal", "Internal error");
        });
    });
    ws.on("pong", () => (conn.seenAt = Date.now()));
    ws.on("close", () => {
      conns.delete(conn);
      void conn.chain.then(() => unsubscribe(conn));
    });
    ws.on("error", () => ws.terminate());
  });

  // Liveness uses real time on purpose (the game clock may be injected in tests).
  const idle = setInterval(() => {
    const t = Date.now();
    for (const c of conns) {
      if (t - c.seenAt > IDLE_MS) c.ws.terminate();
      else if (c.ws.readyState === WebSocket.OPEN) c.ws.ping();
    }
  }, 15_000);
  idle.unref();

  async function upgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    try {
      if (!originAllowed(req.headers.origin, req.headers.host, ctx.config.appOrigin)) return refuse(socket, 403, "Forbidden");
      const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
      const user = await userForToken(ctx.db, token, ctx.now());
      if (!user) return refuse(socket, 401, "Unauthorized");
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req, user));
    } catch (err) {
      console.error("[ws] upgrade failed:", err instanceof Error ? err.message : err);
      refuse(socket, 500, "Internal Server Error");
    }
  }

  return {
    upgrade,
    async close() {
      clearInterval(idle);
      for (const c of conns) c.ws.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
}
