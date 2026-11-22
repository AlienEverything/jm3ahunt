import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { getRequestListener } from "@hono/node-server";
import { loadConfig, type AppConfig } from "./config";
import { createContext, type AppContext } from "./context";
import { createApi } from "./http";
import { createWsGateway } from "./ws";

export interface AppServerOptions {
  /** false: API + WS only (integration tests). */
  withNext: boolean;
  config?: AppConfig;
  /** Game clock (epoch ms). Tests inject a controllable one. */
  now?: () => number;
  /** Run the 1 s engine tick (default true). Tests turn it off and call `ctx.registry.tick()`. */
  autoTick?: boolean;
}

export interface AppServer {
  server: Server;
  config: AppConfig;
  ctx: AppContext;
  listen(port?: number): Promise<number>;
  /** Snapshots every live match, then closes sockets, HTTP and the DB. */
  close(): Promise<void>;
}

const pathOf = (req: IncomingMessage) => (req.url ?? "/").split("?")[0];

export async function createAppServer({ withNext, config = loadConfig(), now = Date.now, autoTick = true }: AppServerOptions): Promise<AppServer> {
  const ctx = await createContext(config, now);
  const api = createApi(ctx);
  // overrideGlobalObjects:false keeps Hono from replacing global Request/Response, which Next relies on.
  const apiListener = getRequestListener(api.fetch, { overrideGlobalObjects: false });
  const gateway = createWsGateway(ctx);

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
      void gateway.upgrade(req, socket, head);
      return;
    }
    // Everything else (Next HMR at /_next/hmr, etc.) goes to Next.
    if (nextUpgrade) {
      void nextUpgrade(req, socket, head);
      return;
    }
    socket.destroy();
  });

  if (autoTick) ctx.registry.start();

  return {
    server,
    config,
    ctx,
    listen(port = config.port) {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        // Render (and most hosts) need 0.0.0.0; locally the default dual-stack bind also serves ::1.
        const onListen = () => resolve((server.address() as AddressInfo).port);
        if (config.isProduction) server.listen(port, "0.0.0.0", onListen);
        else server.listen(port, onListen);
      });
    },
    async close() {
      ctx.registry.stop();
      await ctx.registry.shutdown();
      await gateway.close();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
      await nextClose?.();
      await ctx.close();
    },
  };
}
