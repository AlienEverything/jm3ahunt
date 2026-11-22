import type { Metadata } from "next";
import { Suspense } from "react";
import { ScreenFallback } from "@/components/layout/ScreenFallback";
import { SignInScreen } from "@/components/screens/SignInScreen";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("auth.signIn") };

export default function Page() {
  return (
    <Suspense fallback={<ScreenFallback />}>
      <SignInScreen />
    </Suspense>
  );
}
