import { isTerminal } from "@/shared";
import { MatchRuntime, type RuntimeDeps } from "./runtime";

/** Finished runtimes linger this long (for connected result screens) before being dropped. */
const FINISHED_TTL_MS = 5 * 60_000;
const ARCHIVE_AFTER_MS = 24 * 3600_000;

/** Every non-terminal match has a runtime here; finished ones are loaded on demand. */
export class Registry {
  private runtimes = new Map<string, MatchRuntime>();
  private loading = new Map<string, Promise<MatchRuntime | null>>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private deps: RuntimeDeps) {}

  /** In-memory runtime, if loaded. */
  peek(id: string) {
    return this.runtimes.get(id);
  }

  /** Loads from the DB when needed. Null if the match does not exist. */
  get(id: string): Promise<MatchRuntime | null> {
    const rt = this.runtimes.get(id);
    if (rt) return Promise.resolve(rt);
    let p = this.loading.get(id);
    if (!p) {
      p = this.deps.store
        .loadMatch(id)
        .then((loaded) => {
          if (!loaded) return null;
          const created = new MatchRuntime(loaded, this.deps);
          this.runtimes.set(id, created);
          return created;
        })
        .finally(() => this.loading.delete(id));
      this.loading.set(id, p);
    }
    return p;
  }

  /** Drops a runtime (match archived). */
  forget(id: string) {
    this.runtimes.delete(id);
  }

  /** Boot: archive stale finished matches, restore live ones (deadlines continue; expired ones finish). */
  async restoreAll() {
    await this.deps.store.archiveOldFinished(this.deps.now() - ARCHIVE_AFTER_MS);
    for (const id of await this.deps.store.nonTerminalMatchIds()) {
      const rt = await this.get(id);
      rt?.tick();
    }
  }

  tick() {
    const now = this.deps.now();
    for (const [id, rt] of this.runtimes) {
      try {
        rt.tick();
      } catch (err) {
        console.error(`[engine] tick failed for match ${id}:`, err instanceof Error ? err.message : err);
      }
      if (isTerminal(rt.state) && rt.clients.size === 0 && now - (rt.endedAt ?? now) >= FINISHED_TTL_MS) this.runtimes.delete(id);
    }
  }

  start(intervalMs = 1000) {
    this.timer ??= setInterval(() => this.tick(), intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async flush() {
    await Promise.all([...this.runtimes.values()].map((rt) => rt.flushWrites()));
  }

  /** Graceful shutdown: snapshot every runtime and wait for the writes. */
  async shutdown() {
    this.stop();
    await Promise.all([...this.runtimes.values()].map((rt) => rt.persistNow()));
  }
}
