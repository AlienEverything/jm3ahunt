// Integration harness: in-process server on port 0, temp DB, injected clock, cookie-jar fetch,
// WS clients that record every raw frame.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import type { MatchEvent, MatchView, ServerMessage, Settings, SettingsPatch, Zone } from "@/shared";
import { CENTER, mainZone, settingsWith } from "@/shared/test-helpers";
import { createAppServer, type AppServer } from "../../server/app";
import { loadConfig } from "../../server/config";

export const T0 = 1_800_000_000_000;

export interface TestEnv {
  app: AppServer;
  base: string;
  clock: { t: number };
  dbFile: string;
  /** Moves the game clock forward, ticking the engine every `step` ms. */
  advance(ms: number, step?: number): void;
  close(): Promise<void>;
}

export async function startEnv(opts: { allowSim?: boolean; dbFile?: string; t?: number } = {}): Promise<TestEnv> {
  const dir = opts.dbFile ? null : mkdtempSync(join(tmpdir(), "jh-"));
  const dbFile = opts.dbFile ?? join(dir!, "test.db").replace(/\\/g, "/");
  const clock = { t: opts.t ?? T0 };
  const config = loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: `file:${dbFile}`,
    SESSION_SECRET: "s".repeat(40),
    TAG_TOKEN_SECRET: "t".repeat(40),
    ALLOW_SIM_GPS: opts.allowSim ? "true" : "false",
    APP_ORIGIN: "http://app.example",
  });
  const app = await createAppServer({ withNext: false, config, now: () => clock.t, autoTick: false });
  const port = await app.listen(0);
  const base = `http://127.0.0.1:${port}`;
  return {
    app,
    base,
    clock,
    dbFile,
    advance(ms, step = 1000) {
      const end = clock.t + ms;
      while (clock.t < end) {
        clock.t = Math.min(end, clock.t + step);
        app.ctx.registry.tick();
      }
    },
    async close() {
      await app.close();
      // libSQL can hold the file briefly on Windows; a leftover temp dir is harmless.
      if (dir) {
        try {
          rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
        } catch {
          /* ignore */
        }
      }
    },
  };
}

export class Api {
  cookie = "";
  user: { id: string; displayName: string } | null = null;
  constructor(readonly base: string) {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test responses are loosely typed
  async req<T = any>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: T }> {
    const res = await fetch(this.base + path, {
      method,
      headers: { origin: this.base, ...(this.cookie ? { cookie: this.cookie } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const [k, v] = pair.split("=");
      if (k === "jh_session") this.cookie = v ? `jh_session=${v}` : "";
    }
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }
}

export async function guest(base: string, name: string): Promise<Api> {
  const a = new Api(base);
  const r = await a.req("POST", "/api/auth/guest", { displayName: name });
  if (r.status !== 201) throw new Error(`guest failed ${r.status}`);
  a.user = r.body.user;
  return a;
}

export class Sock {
  frames: ServerMessage[] = [];
  raw: string[] = [];
  private waiters: Array<() => void> = [];
  private constructor(readonly ws: WebSocket) {
    ws.on("message", (d) => {
      const s = d.toString();
      this.raw.push(s);
      this.frames.push(JSON.parse(s));
      for (const w of this.waiters.splice(0)) w();
    });
  }

  static open(base: string, cookie: string, origin = base): Promise<Sock> {
    const ws = new WebSocket(base.replace("http", "ws") + "/ws", { headers: { cookie, origin } });
    const s = new Sock(ws);
    return new Promise((resolve, reject) => {
      ws.once("open", () => resolve(s));
      ws.once("error", reject);
      ws.once("unexpected-response", (_req, res) => reject(new Error(`ws refused ${res.statusCode}`)));
    });
  }

  send(m: unknown) {
    this.ws.send(JSON.stringify(m));
  }

  /** Index to search from (frames received after this point). */
  mark() {
    return this.frames.length;
  }

  async waitFor<T extends ServerMessage>(pred: (f: ServerMessage) => f is T, from?: number, timeoutMs?: number): Promise<T>;
  async waitFor(pred: (f: ServerMessage) => boolean, from?: number, timeoutMs?: number): Promise<ServerMessage>;
  async waitFor(pred: (f: ServerMessage) => boolean, from = 0, timeoutMs = 3000): Promise<ServerMessage> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const hit = this.frames.slice(from).find(pred);
      if (hit) return hit;
      if (Date.now() > deadline) throw new Error(`timeout waiting for frame; last types: ${this.frames.slice(-8).map((f) => (f.t === "event" ? `event:${f.e.type}` : f.t)).join(", ")}`);
      await new Promise<void>((r) => {
        this.waiters.push(r);
        setTimeout(r, 50);
      });
    }
  }

  view(pred: (v: MatchView) => boolean = () => true, from = 0) {
    return this.waitFor((f) => f.t === "view" && pred(f.v), from).then((f) => (f as { v: MatchView }).v);
  }

  event(type: string, from = 0) {
    return this.waitFor((f) => f.t === "event" && f.e.type === type, from).then((f) => (f as { e: MatchEvent }).e);
  }

  ack(opId: string, from = 0) {
    return this.waitFor((f) => f.t === "ack" && f.opId === opId, from) as Promise<Extract<ServerMessage, { t: "ack" }>>;
  }

  lastView(): MatchView {
    const v = [...this.frames].reverse().find((f) => f.t === "view");
    if (!v || v.t !== "view") throw new Error("no view yet");
    return v.v;
  }

  events() {
    return this.frames.filter((f): f is Extract<ServerMessage, { t: "event" }> => f.t === "event").map((f) => f.e);
  }

  /** Round-trip barrier: everything sent before has been processed. */
  async sync() {
    const from = this.mark();
    this.send({ t: "hb" });
    await this.waitFor((f) => f.t === "hbAck", from);
  }

  close() {
    return new Promise<void>((r) => {
      if (this.ws.readyState === WebSocket.CLOSED) return r();
      this.ws.once("close", () => r());
      this.ws.close();
    });
  }
}

let op = 0;
export const opId = () => `op-${++op}-${Math.random().toString(36).slice(2, 8)}`;

export async function hostOp(s: Sock, body: Record<string, unknown>) {
  const id = opId();
  const from = s.mark();
  s.send({ t: "host", opId: id, ...body });
  return s.ack(id, from);
}

export async function action(s: Sock, t: string, body: Record<string, unknown> = {}) {
  const id = opId();
  const from = s.mark();
  s.send({ t, opId: id, ...body });
  return s.ack(id, from);
}

export const defaultZones = (radiusM = 1000): Zone[] => [mainZone(radiusM)];
export { CENTER };

export interface Setup {
  users: Api[];
  socks: Sock[];
  matchId: string;
  groupId: string;
  hash: string;
}

/** n guests in one group; users[0] owns it and creates a quick-start lobby. Everyone connects, consents, readies. */
export async function setupLobby(env: TestEnv, n: number, patch: SettingsPatch = {}, zones: Zone[] = defaultZones(), opts: { ready?: boolean } = {}): Promise<Setup> {
  const users: Api[] = [];
  for (let i = 0; i < n; i++) users.push(await guest(env.base, `P${i}`));
  const g = await users[0].req("POST", "/api/groups", { name: "Crew", icon: "🎯" });
  const groupId = g.body.id;
  for (const u of users.slice(1)) {
    const j = await u.req("POST", "/api/groups/join", { codeOrToken: g.body.joinCode });
    if (j.status !== 200) throw new Error(`join ${j.status} ${JSON.stringify(j.body)}`);
  }
  const settings: Settings = settingsWith({ general: { minPlayers: 2 }, ...patch });
  const m = await users[0].req("POST", `/api/groups/${groupId}/matches`, { name: "Test", settings, zones, quickStart: true });
  if (m.status !== 201) throw new Error(`create match ${m.status} ${JSON.stringify(m.body)}`);
  const matchId = m.body.id;
  const hash = m.body.settingsHash;
  const socks: Sock[] = [];
  for (const u of users) {
    const s = await Sock.open(env.base, u.cookie);
    s.send({ t: "hello", matchId });
    await s.view();
    socks.push(s);
  }
  if (opts.ready !== false) {
    for (const s of socks) {
      s.send({ t: "consent", accept: true, settingsHash: hash });
      s.send({ t: "ready", ready: true });
      await s.sync();
    }
  }
  return { users, socks, matchId, groupId, hash };
}

/** Starts and runs countdown + hiding so the match is `active`. */
export async function startActive(env: TestEnv, s: Setup) {
  const a = await hostOp(s.socks[0], { op: "start" });
  if (!a.ok) throw new Error(`start failed: ${JSON.stringify(a)}`);
  const v = await s.socks[0].view((x) => x.state === "countdown");
  const until = (v.clock.activeStartedAt ?? env.clock.t) - env.clock.t;
  env.advance(until);
  await Promise.all(s.socks.map((k) => k.view((x) => x.state === "active")));
}

export const loc = (lat: number, lng: number, acc = 5) => ({ t: "loc", lat, lng, acc, ts: 0 });

export const roleOf = (v: MatchView, userId: string) => v.players.find((p) => p.userId === userId)?.role ?? null;
