import type { Metadata } from "next";
import { Suspense } from "react";
import { ScreenFallback } from "@/components/layout/ScreenFallback";
import { InviteScreen } from "@/components/screens/JoinScreens";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("invite.title") };

export default function Page() {
  return (
    <Suspense fallback={<ScreenFallback />}>
      <InviteScreen />
    </Suspense>
  );
}
