"use client";

import { useState } from "react";
import { EyeOff, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { summarizeSettings, type MatchView } from "@/shared";
import { Sheet } from "@/components/common/Sheet";
import { Button } from "@/components/ui/button";
import { t, tm } from "@/i18n";
import type { UseMatch } from "@/lib/ws";

/** Plain-language list of exactly what this player shares, with whom; explicit agree / withdraw. */
export function ConsentSheet({ open, onOpenChange, view, send }: { open: boolean; onOpenChange: (o: boolean) => void; view: MatchView; send: UseMatch["send"] }) {
  const [busy, setBusy] = useState(false);
  const sharing = summarizeSettings(view.settings, view.zones).filter((l) => l.section === "sharing");
  const agreed = view.me?.consentValid ?? false;

  async function decide(accept: boolean) {
    setBusy(true);
    const r = await send(accept ? { t: "consent", accept: true, settingsHash: view.settingsHash } : { t: "consent", accept: false });
    setBusy(false);
    if (!r.ok) return toast.error(t("lobby.offlineAction"));
    toast.success(accept ? t("consent.agreed") : t("consent.withdrawn"));
    onOpenChange(false);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("consent.title")}
      description={t("consent.intro")}
      footer={
        agreed ? (
          <Button variant="outline" onClick={() => decide(false)} disabled={busy}>
            <EyeOff aria-hidden />
            {t("consent.withdraw")}
          </Button>
        ) : (
          <Button size="lg" onClick={() => decide(true)} disabled={busy || !view.me}>
            {t("consent.agree")}
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-5">
        <ul className="flex flex-col gap-2.5 text-[15px] leading-relaxed">
          {sharing.map((l, i) => (
            <li key={i} className="flex gap-2.5">
              <span aria-hidden className="mt-2.5 size-1.5 shrink-0 rounded-full bg-primary" />
              <span>{tm(l)}</span>
            </li>
          ))}
        </ul>
        <div role="note" className="flex gap-3 rounded-xl bg-muted p-4 text-sm">
          <Smartphone aria-hidden className="mt-0.5 size-4 shrink-0" />
          <div className="flex flex-col gap-1">
            <span className="font-medium">{t("consent.browserTitle")}</span>
            <span className="text-muted-foreground">{t("consent.browserBody")}</span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{agreed ? t("consent.withdrawNote") : t("consent.when")}</p>
      </div>
    </Sheet>
  );
}
