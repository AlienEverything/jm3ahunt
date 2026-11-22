"use client";

import { useCallback, useEffect, useState } from "react";
import { LocateFixed, LocateOff, Loader2, MapPinCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";

export type GpsStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "ok"; accuracy: number }
  | { kind: "denied" }
  | { kind: "unavailable" }
  | { kind: "insecure" }
  | { kind: "unsupported" };

/** Permission + one reading. Only the accuracy is kept; the position is discarded here. */
export function useGpsCheck() {
  const [status, setStatus] = useState<GpsStatus>({ kind: "idle" });

  const check = useCallback(() => {
    if (!window.isSecureContext) return setStatus({ kind: "insecure" });
    if (!("geolocation" in navigator)) return setStatus({ kind: "unsupported" });
    setStatus({ kind: "checking" });
    navigator.geolocation.getCurrentPosition(
      (pos) => setStatus({ kind: "ok", accuracy: Math.round(pos.coords.accuracy) }),
      (err) => setStatus({ kind: err.code === err.PERMISSION_DENIED ? "denied" : "unavailable" }),
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 30_000 },
    );
  }, []);

  useEffect(() => {
    let perm: PermissionStatus | null = null;
    let live = true;
    const onChange = () => {
      if (perm?.state === "granted") check();
      else if (perm?.state === "denied") setStatus({ kind: "denied" });
    };
    if (!window.isSecureContext) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStatus({ kind: "insecure" });
      return;
    }
    // Safari < 16 has no geolocation permission query; the button still works.
    navigator.permissions
      ?.query({ name: "geolocation" })
      .then((p) => {
        if (!live) return;
        perm = p;
        onChange();
        p.addEventListener("change", onChange);
      })
      .catch(() => {});
    return () => {
      live = false;
      perm?.removeEventListener("change", onChange);
    };
  }, [check]);

  return { status, check, ok: status.kind === "ok" };
}

const ICON = { ok: MapPinCheck, checking: Loader2 } as const;

export function GpsCheckCard({ status, onCheck }: { status: GpsStatus; onCheck: () => void }) {
  const Icon = ICON[status.kind as keyof typeof ICON] ?? (status.kind === "idle" ? LocateFixed : LocateOff);
  const bad = status.kind === "denied" || status.kind === "unavailable" || status.kind === "insecure" || status.kind === "unsupported";
  const poor = status.kind === "ok" && status.accuracy > 50;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <Icon aria-hidden className={cn("mt-0.5 size-5 shrink-0", status.kind === "ok" ? (poor ? "text-warning" : "text-success") : bad ? "text-danger" : "text-muted-foreground", status.kind === "checking" && "animate-spin")} />
        <div className="flex min-w-0 flex-1 flex-col gap-1" aria-live="polite">
          <span className="font-medium">{t(`gps.status.${status.kind}`)}</span>
          {status.kind === "ok" && <span className="text-sm text-muted-foreground">{t(poor ? "gps.accuracyPoor" : "gps.accuracy", { m: status.accuracy })}</span>}
          {status.kind === "idle" && <span className="text-sm text-muted-foreground">{t("gps.idleBody")}</span>}
          {status.kind === "insecure" && <span className="text-sm text-muted-foreground">{t("gps.insecureBody")}</span>}
          {status.kind === "unavailable" && <span className="text-sm text-muted-foreground">{t("gps.unavailableBody")}</span>}
        </div>
        {status.kind !== "insecure" && status.kind !== "unsupported" && (
          <Button variant="outline" size="sm" onClick={onCheck} disabled={status.kind === "checking"}>
            {status.kind === "idle" ? t("gps.check") : t("gps.recheck")}
          </Button>
        )}
      </div>
      {status.kind === "denied" && (
        <div className="grid gap-3 rounded-xl bg-muted p-3 text-sm sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <span className="font-medium">{t("gps.fix.iosTitle")}</span>
            <ol className="list-decimal ps-5 text-muted-foreground">
              <li>{t("gps.fix.ios1")}</li>
              <li>{t("gps.fix.ios2")}</li>
              <li>{t("gps.fix.ios3")}</li>
            </ol>
          </div>
          <div className="flex flex-col gap-1">
            <span className="font-medium">{t("gps.fix.androidTitle")}</span>
            <ol className="list-decimal ps-5 text-muted-foreground">
              <li>{t("gps.fix.android1")}</li>
              <li>{t("gps.fix.android2")}</li>
              <li>{t("gps.fix.android3")}</li>
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}
