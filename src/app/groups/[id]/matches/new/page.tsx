import type { Metadata } from "next";
import { Suspense } from "react";
import { ScreenFallback } from "@/components/layout/ScreenFallback";
import { NewMatchScreen } from "@/components/screens/MatchSetupScreens";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("setup.newTitle") };

export default function Page() {
  return (
    <Suspense fallback={<ScreenFallback />}>
      <NewMatchScreen />
    </Suspense>
  );
}
