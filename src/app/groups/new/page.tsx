import type { Metadata } from "next";
import { Suspense } from "react";
import { ScreenFallback } from "@/components/layout/ScreenFallback";
import { NewGroupScreen } from "@/components/screens/NewGroupScreen";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("group.newTitle") };

export default function Page() {
  return (
    <Suspense fallback={<ScreenFallback />}>
      <NewGroupScreen />
    </Suspense>
  );
}
