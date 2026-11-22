import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { getRequestListener } from "@hono/node-server";
import { loadConfig, type AppConfig } from "./config";
import { createApi } from "./http";
import { createWsGateway } from "./ws";

export interface AppServerOptions {
  /** false: API + WS only (integration tests). */
  withNext: boolean;
  config?: AppConfig;
}

export interface AppServer {
  server: Server;
  config: AppConfig;
  listen(port?: number): Promise<number>;
  close(): Promise<void>;
}

const pathOf = (req: IncomingMessage) => (req.url ?? "/").split("?")[0];

export async function createAppServer({ withNext, config = loadConfig() }: AppServerOptions): Promise<AppServer> {
  const api = createApi(config);
  // overrideGlobalObjects:false keeps Hono from replacing global Request/Response, which Next relies on.
  const apiListener = getRequestListener(api.fetch, { overrideGlobalObjects: false });
  const wss = createWsGateway();

  let nextHandle: ((req: IncomingMessage, res: import("node:http").ServerResponse) => Promise<void>) | null = null;
  let nextUpgrade: ((req: IncomingMessage, socket: Duplex, head: Buffer) => Promise<void>) | null = null;
  let nextClose: (() => Promise<void>) | null = null;

  if (withNext) {
    const { default: next } = await import("next");
    const app = next({ dev: !config.isProduction, dir: process.cwd() });
    await app.prepare();
    nextHandle = app.getRequestHandler();
    nextUpgrade = app.getUpgradeHandler();
    nextClose = () => app.close();
  }

  const server = createServer((req, res) => {
    const path = pathOf(req);
    if (path === "/api" || path.startsWith("/api/")) {
      void apiListener(req, res);
      return;
    }
    if (nextHandle) {
      void nextHandle(req, res);
      return;
    }
    res.statusCode = 404;
    res.end();
  });

  server.on("upgrade", (req, socket, head) => {
    if (pathOf(req) === "/ws") {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
      return;
    }
    // Everything else (Next HMR at /_next/hmr, etc.) goes to Next.
    if (nextUpgrade) {
      void nextUpgrade(req, socket, head);
      return;
    }
    socket.destroy();
  });

  return {
    server,
    config,
    listen(port = config.port) {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, () => resolve((server.address() as AddressInfo).port));
      });
    },
    async close() {
      for (const client of wss.clients) client.terminate();
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await nextClose?.();
    },
  };
}
