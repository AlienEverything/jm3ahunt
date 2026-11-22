import type { MatchState } from "../types";

/** Legal moves. Any non-terminal state may also end (→ finished). */
export const MATCH_TRANSITIONS: Readonly<Record<MatchState, readonly MatchState[]>> = {
  draft: ["lobby", "finished"],
  lobby: ["preflight", "finished"],
  preflight: ["countdown", "lobby", "finished"],
  countdown: ["hiding", "active", "paused", "finished"],
  hiding: ["active", "paused", "finished"],
  active: ["paused", "finished"],
  paused: ["countdown", "hiding", "active", "finished"],
  finished: ["archived"],
  archived: [],
};

export const TERMINAL_STATES: readonly MatchState[] = ["finished", "archived"];
export const isTerminal = (s: MatchState) => TERMINAL_STATES.includes(s);
export const PAUSABLE_STATES = ["countdown", "hiding", "active"] as const;
export type PausableState = (typeof PAUSABLE_STATES)[number];
export const isPausable = (s: MatchState): s is PausableState => (PAUSABLE_STATES as readonly MatchState[]).includes(s);

export class IllegalTransitionError extends Error {
  constructor(
    readonly from: MatchState,
    readonly to: MatchState,
  ) {
    super(`Illegal match transition ${from} → ${to}`);
    this.name = "IllegalTransitionError";
  }
}

/** `pausedFrom` restricts paused → X to the state the match was paused from (or finished). */
export function canTransition(from: MatchState, to: MatchState, ctx: { pausedFrom?: PausableState } = {}): boolean {
  if (!MATCH_TRANSITIONS[from].includes(to)) return false;
  if (from === "paused" && to !== "finished" && ctx.pausedFrom !== undefined && ctx.pausedFrom !== to) return false;
  return true;
}

export function assertTransition(from: MatchState, to: MatchState, ctx: { pausedFrom?: PausableState } = {}): void {
  if (!canTransition(from, to, ctx)) throw new IllegalTransitionError(from, to);
}
