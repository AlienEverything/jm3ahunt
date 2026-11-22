import type { Metadata } from "next";
import { Suspense } from "react";
import { ScreenFallback } from "@/components/layout/ScreenFallback";
import { GroupScreen } from "@/components/screens/GroupScreen";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("group.title") };

export default function Page() {
  return (
    <Suspense fallback={<ScreenFallback />}>
      <GroupScreen />
    </Suspense>
  );
}
