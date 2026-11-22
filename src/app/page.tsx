import { t } from "@/i18n";

// Placeholder. Task 3 builds the real landing page.
export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
      <h1 className="text-2xl font-semibold">{t("app.name")}</h1>
      <p className="text-muted-foreground">{t("app.tagline")}</p>
      <p className="font-mono text-sm text-muted-foreground">{t("app.placeholder")}</p>
    </main>
  );
}
