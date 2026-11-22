import type { Metadata } from "next";
import { Suspense } from "react";
import { ScreenFallback } from "@/components/layout/ScreenFallback";
import { DashboardScreen } from "@/components/screens/DashboardScreen";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("dashboard.title") };

export default function Page() {
  return (
    <Suspense fallback={<ScreenFallback />}>
      <DashboardScreen />
    </Suspense>
  );
}
