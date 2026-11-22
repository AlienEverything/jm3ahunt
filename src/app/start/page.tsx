import type { Metadata } from "next";
import { Suspense } from "react";
import { ScreenFallback } from "@/components/layout/ScreenFallback";
import { StartScreen } from "@/components/screens/StartScreen";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("start.title") };

export default function Page() {
  return (
    <Suspense fallback={<ScreenFallback />}>
      <StartScreen />
    </Suspense>
  );
}
