"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "@/i18n";

/** Error from a REST call. `code` comes from the server's `{error: {code, message}}` body. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
  /** Default true: a 401 sends the user to onboarding and back here afterwards. */
  redirectOn401?: boolean;
}

/** Same-origin path with a leading slash and no protocol-relative tricks. */
export function safeNext(next: string | null | undefined, fallback = "/dashboard"): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : fallback;
}

export function startUrl(next: string) {
  return `/start?next=${encodeURIComponent(next)}`;
}

export async function api<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const { method = opts.body === undefined ? "GET" : "POST", body, signal, redirectOn401 = true } = opts;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      signal,
      credentials: "same-origin",
      headers: body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError(0, "network", t("errors.network"));
  }

  const text = await res.text();
  let data: unknown = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
  }

  if (!res.ok) {
    const err = (data as { error?: { code?: unknown; message?: unknown } } | undefined)?.error;
    const code = typeof err?.code === "string" ? err.code : `http_${res.status}`;
    const message = typeof err?.message === "string" ? err.message : t("errors.generic");
    if (res.status === 401 && redirectOn401 && typeof window !== "undefined" && window.location.pathname !== "/start") {
      window.location.assign(startUrl(window.location.pathname + window.location.search));
    }
    throw new ApiError(res.status, code, message);
  }
  return data as T;
}

/** Human message for any thrown value. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return t("errors.generic");
}

export interface Query<T> {
  data: T | undefined;
  error: ApiError | undefined;
  loading: boolean;
  reload: () => Promise<void>;
  setData: (fn: (prev: T | undefined) => T | undefined) => void;
}

/** GET on mount (and when `path` changes). `null` path = skip. */
export function useApiQuery<T>(path: string | null, opts: Pick<ApiOptions, "redirectOn401"> = {}): Query<T> {
  const [data, setDataState] = useState<T | undefined>(undefined);
  const [error, setError] = useState<ApiError | undefined>(undefined);
  const [loading, setLoading] = useState(path !== null);
  const redirect = opts.redirectOn401 ?? true;
  const ctrl = useRef<AbortController | null>(null);

  const reload = useCallback(async () => {
    if (path === null) return;
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setLoading(true);
    try {
      const d = await api<T>(path, { signal: c.signal, redirectOn401: redirect });
      if (!c.signal.aborted) {
        setDataState(d);
        setError(undefined);
      }
    } catch (e) {
      if (c.signal.aborted) return;
      setError(e instanceof ApiError ? e : new ApiError(0, "unknown", t("errors.generic")));
    } finally {
      if (!c.signal.aborted) setLoading(false);
    }
  }, [path, redirect]);

  useEffect(() => {
    // Initial fetch for this path; state updates happen after the await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
    return () => ctrl.current?.abort();
  }, [reload]);

  const setData = useCallback((fn: (prev: T | undefined) => T | undefined) => setDataState(fn), []);
  return { data, error, loading, reload, setData };
}
