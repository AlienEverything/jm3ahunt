import type { Metadata } from "next";
import { Suspense } from "react";
import { ScreenFallback } from "@/components/layout/ScreenFallback";
import { MatchScreen } from "@/components/screens/MatchScreen";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("match.title") };

export default function Page() {
  return (
    <Suspense fallback={<ScreenFallback />}>
      <MatchScreen />
    </Suspense>
  );
}
