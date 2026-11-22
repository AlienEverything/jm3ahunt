import { ImageResponse } from "next/og";
import { IconArt } from "@/lib/app-icon";

const SIZES = { "192": 192, "512": 512, maskable: 512 } as const;

export function generateImageMetadata() {
  return (Object.keys(SIZES) as Array<keyof typeof SIZES>).map((id) => ({ id, contentType: "image/png", size: { width: SIZES[id], height: SIZES[id] } }));
}

export default async function Icon({ id }: { id: Promise<string | number> }) {
  const key = String(await id) as keyof typeof SIZES;
  const size = SIZES[key] ?? 192;
  // Maskable icons get cropped to a circle: keep the mark inside the central 80 %.
  return new ImageResponse(<IconArt size={size} scale={key === "maskable" ? 0.56 : 0.72} />, { width: size, height: size });
}
