// Server clock offset (SPEC §10): NTP-style midpoint from `welcome` / `hbAck`.
// Keeps the sample with the smallest round trip, since that one has the least error.

let offsetMs = 0;
let bestRtt = Number.POSITIVE_INFINITY;
let sampledAt = 0;

/** Record a server timestamp received for a request sent at `sentAt` (client ms). */
export function recordServerTime(serverNow: number, sentAt: number, receivedAt = Date.now()) {
  const rtt = Math.max(0, receivedAt - sentAt);
  // Old samples drift; let a fresh one win after 5 minutes even with a worse round trip.
  const stale = receivedAt - sampledAt > 5 * 60_000;
  if (rtt <= bestRtt || stale) {
    bestRtt = rtt;
    sampledAt = receivedAt;
    offsetMs = serverNow - (sentAt + receivedAt) / 2;
  }
}

/** Current server epoch ms. */
export const serverNow = () => Date.now() + offsetMs;

export const serverOffsetMs = () => offsetMs;
