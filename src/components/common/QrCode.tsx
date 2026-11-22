"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Skeleton } from "@/components/ui/skeleton";

/** QR of `value`, always dark-on-white so phone cameras read it in either theme. */
export function QrCode({ value, label, size = 200 }: { value: string; label: string; size?: number }) {
  const [src, setSrc] = useState<{ value: string; url: string } | null>(null);
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(value, { margin: 1, width: size * 2, errorCorrectionLevel: "M" })
      .then((url) => live && setSrc({ value, url }))
      .catch(() => live && setSrc(null));
    return () => {
      live = false;
    };
  }, [value, size]);
  return (
    <div className="inline-flex rounded-2xl bg-white p-3 ring-1 ring-black/10" style={{ width: size + 24, height: size + 24 }}>
      {src?.value === value ? (
        // eslint-disable-next-line @next/next/no-img-element -- data URL, nothing for next/image to optimise
        <img src={src.url} alt={label} width={size} height={size} className="block" />
      ) : (
        <Skeleton className="size-full rounded-lg bg-black/10" />
      )}
    </div>
  );
}
