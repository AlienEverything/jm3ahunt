import Link from "next/link";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <Compass aria-hidden className="size-8 text-muted-foreground" />
      <h1 className="text-2xl font-semibold tracking-tight">{t("errors.notFoundTitle")}</h1>
      <p className="text-muted-foreground">{t("errors.notFoundBody")}</p>
      <Button render={<Link href="/dashboard" />} nativeButton={false}>
        {t("errors.goHome")}
      </Button>
    </main>
  );
}
