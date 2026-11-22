import { WebSocketServer } from "ws";
import type { ServerMessage } from "@/shared/schemas/ws";

/** WebSocket gateway on /ws. Stub: greets each socket. Task 2 adds auth and the protocol. */
export function createWsGateway() {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 });

  wss.on("connection", (socket) => {
    const welcome: ServerMessage = { t: "welcome", serverNow: Date.now(), userId: null };
    socket.send(JSON.stringify(welcome));
  });

  return wss;
}
