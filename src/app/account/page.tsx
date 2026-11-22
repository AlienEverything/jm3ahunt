import type { Metadata } from "next";
import { Suspense } from "react";
import { ScreenFallback } from "@/components/layout/ScreenFallback";
import { AccountScreen } from "@/components/screens/AccountScreen";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("account.title") };

export default function Page() {
  return (
    <Suspense fallback={<ScreenFallback />}>
      <AccountScreen />
    </Suspense>
  );
}
