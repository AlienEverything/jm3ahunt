"use client";

import Link from "next/link";
import { CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <CircleAlert aria-hidden className="size-8 text-danger" />
      <h1 className="text-2xl font-semibold tracking-tight">{t("errors.crashTitle")}</h1>
      <p className="text-muted-foreground">{t("errors.crashBody")}</p>
      <div className="flex gap-2">
        <Button onClick={reset}>{t("common.retry")}</Button>
        <Button variant="outline" render={<Link href="/dashboard" />} nativeButton={false}>
          {t("errors.goHome")}
        </Button>
      </div>
    </main>
  );
}
