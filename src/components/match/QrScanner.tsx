"use client";

import { useEffect, useRef, useState } from "react";
import { CameraOff } from "lucide-react";
import { t } from "@/i18n";

interface Detector {
  detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>>;
}
declare global {
  interface Window {
    BarcodeDetector?: { new (opts: { formats: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> };
  }
}

async function nativeDetector(): Promise<Detector | null> {
  const BD = window.BarcodeDetector;
  if (!BD) return null;
  try {
    const formats = (await BD.getSupportedFormats?.()) ?? ["qr_code"];
    return formats.includes("qr_code") ? new BD({ formats: ["qr_code"] }) : null;
  } catch {
    return null;
  }
}

/** Camera QR scanner: native BarcodeDetector where available, `qr-scanner` otherwise. Calls `onResult` once. */
export function QrScanner({ onResult }: { onResult: (text: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState(false);
  const done = useRef(false);
  const cb = useRef(onResult);
  useEffect(() => {
    cb.current = onResult;
  });

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    let stop: () => void = () => {};
    let dead = false;
    const hit = (text: string) => {
      if (done.current || !text) return;
      done.current = true;
      cb.current(text);
    };
    (async () => {
      const det = await nativeDetector();
      if (dead) return;
      if (det) {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        if (dead) return stream.getTracks().forEach((tr) => tr.stop());
        v.srcObject = stream;
        await v.play();
        const timer = setInterval(async () => {
          try {
            const codes = await det.detect(v);
            if (codes[0]) hit(codes[0].rawValue);
          } catch {
            // frame not ready
          }
        }, 200);
        stop = () => {
          clearInterval(timer);
          stream.getTracks().forEach((tr) => tr.stop());
        };
      } else {
        const { default: QrScannerLib } = await import("qr-scanner");
        if (dead) return;
        const s = new QrScannerLib(v, (r) => hit(r.data), { preferredCamera: "environment", returnDetailedScanResult: true, maxScansPerSecond: 5 });
        await s.start();
        stop = () => s.destroy();
      }
    })().catch(() => !dead && setError(true));
    return () => {
      dead = true;
      stop();
    };
  }, []);

  return (
    <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-black">
      <video ref={video} className="size-full object-cover" muted playsInline aria-label={t("live.qr.cameraLabel")} />
      <span aria-hidden className="pointer-events-none absolute inset-[18%] rounded-2xl border-2 border-white/80" />
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-sm text-white">
          <CameraOff aria-hidden className="size-6" />
          {t("live.qr.noCamera")}
        </div>
      )}
    </div>
  );
}
