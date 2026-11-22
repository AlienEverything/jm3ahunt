import { summarizeSettings, type Settings, type SummarySection, type Zone } from "@/shared";
import { t, tm } from "@/i18n";
import { cn } from "@/lib/utils";

const ORDER: SummarySection[] = ["match", "sharing", "capture", "zones"];

/** Plain-language rules from summarizeSettings, grouped by section. */
export function RulesSummary({ settings, zones = [], sections = ORDER, className }: { settings: Settings; zones?: readonly Zone[]; sections?: SummarySection[]; className?: string }) {
  const lines = summarizeSettings(settings, zones);
  return (
    <div className={cn("flex flex-col gap-5", className)}>
      {sections.map((sec) => {
        const mine = lines.filter((l) => l.section === sec);
        if (mine.length === 0) return null;
        return (
          <div key={sec} className="flex flex-col gap-2">
            <h3 className="text-[13px] font-semibold tracking-wide text-muted-foreground uppercase">{t(`summary.sections.${sec}`)}</h3>
            <ul className="flex flex-col gap-1.5 text-sm leading-relaxed">
              {mine.map((l, i) => (
                <li key={i} className="flex gap-2">
                  <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground/60" />
                  <span>{tm(l)}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/** One line for cards: "30 min · approx pings every 5 min · convert". */
export function shortRules(s: Settings): string {
  const parts = [t("units.minutes", { n: s.timing.durationMin })];
  const p = s.visibility.pings;
  parts.push(p.enabled ? t(p.precision === "approx" ? "rules.pingsApprox" : "rules.pingsExact", { intervalSec: p.intervalSec }) : t("rules.noPings"));
  parts.push(t(`rules.outcome.${s.capture.outcome}`));
  return parts.join(" · ");
}
