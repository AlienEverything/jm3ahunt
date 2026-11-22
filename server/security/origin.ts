import type { IncomingHttpHeaders } from "node:http";

/** Origin must equal APP_ORIGIN or share the request's host. Missing Origin is refused. */
export function originAllowed(origin: string | undefined | null, host: string | undefined | null, appOrigin: string): boolean {
  if (!origin) return false;
  try {
    const o = new URL(origin);
    if (o.origin === new URL(appOrigin).origin) return true;
    return !!host && o.host === host;
  } catch {
    return false;
  }
}

/** Client IP. Behind Render's proxy the last X-Forwarded-For entry is the one the proxy added. */
export function clientIp(headers: IncomingHttpHeaders | Headers, socketIp?: string): string {
  const raw = headers instanceof Headers ? headers.get("x-forwarded-for") : headers["x-forwarded-for"];
  const xff = Array.isArray(raw) ? raw.join(",") : raw;
  const last = xff?.split(",").map((s) => s.trim()).filter(Boolean).pop();
  return last ?? socketIp ?? "unknown";
}

export function parseCookies(header: string | undefined | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
