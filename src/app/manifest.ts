import type { MetadataRoute } from "next";
import { t } from "@/i18n";
import { ICON_BG } from "@/lib/app-icon";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: t("app.name"),
    short_name: "Jm3a Hunt",
    description: t("app.tagline"),
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    // Paper / ink tokens from globals.css (light background, ink chrome).
    background_color: "#faf9f6",
    theme_color: ICON_BG,
    icons: [
      { src: "/icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon/maskable", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
