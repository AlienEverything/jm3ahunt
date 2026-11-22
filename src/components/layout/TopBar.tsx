"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./ThemeToggle";

interface TopBarProps {
  title?: string;
  /** Link target for the back button; `true` = browser back. Omit on top-level pages. */
  back?: string | true;
  /** Extra actions before the theme toggle. */
  actions?: ReactNode;
  /** Match a `<Page wide>` column. */
  wide?: boolean;
}

export function TopBar({ title, back, actions, wide }: TopBarProps) {
  const router = useRouter();
  return (
    <header className="sticky top-0 z-40 border-b border-transparent bg-background/90 pt-safe backdrop-blur supports-backdrop-filter:bg-background/75">
      <div className={cn("mx-auto flex h-14 w-full items-center gap-1 px-2", wide ? "max-w-5xl" : "max-w-2xl")}>
        {back === true ? (
          <Button variant="ghost" size="icon" onClick={() => router.back()} aria-label={t("common.back")}>
            <ChevronLeft aria-hidden className="size-5 rtl:rotate-180" />
          </Button>
        ) : back ? (
          <Button variant="ghost" size="icon" render={<Link href={back} />} nativeButton={false} aria-label={t("common.back")}>
            <ChevronLeft aria-hidden className="size-5 rtl:rotate-180" />
          </Button>
        ) : (
          <Link href="/dashboard" className="flex h-11 items-center gap-2 rounded-xl px-2 font-semibold tracking-tight outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            <span aria-hidden className="size-2.5 rounded-full bg-primary" />
            {t("app.name")}
          </Link>
        )}
        <h1 className={cn("min-w-0 flex-1 truncate text-base font-semibold", !back && "sr-only")}>{title ?? t("app.name")}</h1>
        {!back && <div className="flex-1" />}
        {actions}
        <ThemeToggle />
      </div>
    </header>
  );
}

/** Content column. `wide` allows the two-column desktop layouts. */
export function Page({ children, wide, className }: { children: ReactNode; wide?: boolean; className?: string }) {
  return <main className={cn("mx-auto flex w-full flex-1 flex-col gap-8 px-4 pt-4 pb-32", wide ? "max-w-5xl" : "max-w-2xl", className)}>{children}</main>;
}

/** Bottom action bar, above the home indicator. Holds the one primary action of the view. */
export function StickyFooter({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/90 pt-3 pb-safe backdrop-blur supports-backdrop-filter:bg-background/75">
      <div className={cn("mx-auto flex w-full items-center gap-2 px-4", wide ? "max-w-5xl" : "max-w-2xl")}>{children}</div>
    </div>
  );
}
