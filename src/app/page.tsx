import Link from "next/link";
import { MapPin, ShieldCheck, Users, Zap } from "lucide-react";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";

const STEPS = [
  { icon: Users, title: "landing.step1Title", body: "landing.step1Body" },
  { icon: Zap, title: "landing.step2Title", body: "landing.step2Body" },
  { icon: MapPin, title: "landing.step3Title", body: "landing.step3Body" },
] as const;

export default function Landing() {
  return (
    <>
      <header className="pt-safe">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-2 px-4">
          <span className="flex items-center gap-2 font-semibold tracking-tight">
            <span aria-hidden className="size-2.5 rounded-full bg-primary" />
            {t("app.name")}
          </span>
          <div className="flex-1" />
          <Button variant="ghost" render={<Link href="/signin" />} nativeButton={false}>
            {t("auth.signIn")}
          </Button>
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-14 px-4 pt-10 pb-16 sm:pt-20">
        <section className="flex max-w-2xl flex-col gap-6">
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-6xl">{t("landing.headline")}</h1>
          <p className="max-w-xl text-lg text-pretty text-muted-foreground">{t("landing.pitch")}</p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button size="lg" render={<Link href="/groups/new" />} nativeButton={false}>
              {t("landing.createGroup")}
            </Button>
            <Button size="lg" variant="outline" render={<Link href="/join" />} nativeButton={false}>
              {t("landing.joinGroup")}
            </Button>
          </div>
          <Link href="/dashboard" className="self-start text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
            {t("landing.openDashboard")}
          </Link>
        </section>

        <section aria-labelledby="how" className="flex flex-col gap-4">
          <h2 id="how" className="text-[13px] font-semibold tracking-wide text-muted-foreground uppercase">
            {t("landing.howItWorks")}
          </h2>
          <ol className="grid gap-3 sm:grid-cols-3">
            {STEPS.map(({ icon: Icon, title, body }, i) => (
              <li key={title} className="flex flex-col gap-2 rounded-2xl border bg-card p-5">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm text-muted-foreground tabular">{String(i + 1).padStart(2, "0")}</span>
                  <Icon aria-hidden className="size-4 text-primary" />
                </div>
                <h3 className="font-semibold">{t(title)}</h3>
                <p className="text-sm text-pretty text-muted-foreground">{t(body)}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="flex max-w-2xl gap-3 rounded-2xl border p-5">
          <ShieldCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-hider" />
          <div className="flex flex-col gap-1">
            <h2 className="font-semibold">{t("landing.privacyTitle")}</h2>
            <p className="text-sm text-pretty text-muted-foreground">{t("landing.privacyBody")}</p>
          </div>
        </section>
      </main>
    </>
  );
}
