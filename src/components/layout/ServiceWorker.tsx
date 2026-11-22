"use client";

import { useEffect } from "react";

/** Registers /sw.js in production only; in development it removes any stale worker so HMR keeps working. */
export function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV === "production") {
      void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
    } else {
      void navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => void r.unregister()));
    }
  }, []);
  return null;
}
