"use client";

import { useEffect, useState } from "react";
import { QrCode as QrIcon, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import type { MatchView, ViewPlayer } from "@/shared";
import { QrCode } from "@/components/common/QrCode";
import { Sheet } from "@/components/common/Sheet";
import { UserAvatar } from "@/components/common/UserAvatar";
import { ackError } from "@/components/lobby/Lobby";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";
import { formatClock, useServerNow } from "@/lib/hooks";
import type { UseMatch } from "@/lib/ws";
import { QrScanner } from "./QrScanner";

const vibrate = (p: number | number[]) => {
  try {
    // Chrome refuses (and logs) vibration before the first tap on the page.
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    navigator.vibrate?.(p);
  } catch {
    // not supported
  }
};
export { vibrate };

function PlayerPick({ players, onPick, busy, action }: { players: ViewPlayer[]; onPick: (p: ViewPlayer) => void; busy: string | null; action: string }) {
  if (players.length === 0) return <p className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">{t("live.tag.nobody")}</p>;
  return (
    <ul className="divide-y overflow-hidden rounded-2xl border">
      {players.map((p) => (
        <li key={p.userId}>
          <button type="button" disabled={busy !== null} onClick={() => onPick(p)} className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-start outline-none hover:bg-muted focus-visible:bg-muted disabled:opacity-60">
            <UserAvatar avatar={p.avatar} name={p.name} />
            <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
            <span className="text-sm font-semibold text-primary">{busy === p.userId ? t("live.tag.sending") : action}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Scan a QR or type the 6-digit code; both go out as `qrScan`. */
function ScanOrCode({ match, qr, code, onDone }: { match: UseMatch; qr: boolean; code: boolean; onDone: () => void }) {
  const [scanning, setScanning] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(token: string) {
    setBusy(true);
    const r = await match.send({ t: "qrScan", token });
    setBusy(false);
    setScanning(false);
    if (r.ok) {
      vibrate([30, 40, 30]);
      toast.success(t("live.tag.scanned"));
      onDone();
    } else toast.error(ackError(r));
  }
  return (
    <div className="flex flex-col gap-4">
      {qr &&
        (scanning ? (
          <QrScanner onResult={submit} />
        ) : (
          <Button variant="outline" size="lg" onClick={() => setScanning(true)}>
            <QrIcon aria-hidden />
            {t("live.qr.scan")}
          </Button>
        ))}
      {code && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (/^\d{6}$/.test(value)) void submit(value);
          }}
        >
          <label htmlFor="tag-code" className="text-sm font-medium">
            {t("live.qr.codeLabel")}
          </label>
          <div className="flex gap-2">
            <Input id="tag-code" inputMode="numeric" autoComplete="off" pattern="\d{6}" maxLength={6} value={value} onChange={(e) => setValue(e.target.value.replace(/\D/g, "").slice(0, 6))} className="font-mono text-lg tracking-[0.3em] tabular" placeholder="000000" />
            <Button type="submit" size="lg" disabled={busy || value.length !== 6}>
              {t("live.qr.submit")}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

/** Seeker: tag a hider (mutual), scan their QR, or type their code. */
export function TagSheet({ open, onOpenChange, view, match }: { open: boolean; onOpenChange: (o: boolean) => void; view: MatchView; match: UseMatch }) {
  const [busy, setBusy] = useState<string | null>(null);
  const methods = view.settings.capture.methods;
  const hiders = view.players.filter((p) => p.role === "hider" && p.status === "free" && p.userId !== view.me?.userId);
  async function tag(p: ViewPlayer) {
    setBusy(p.userId);
    const r = await match.send({ t: "tag", hiderId: p.userId });
    setBusy(null);
    if (r.ok) {
      toast(t("live.tag.waiting", { name: p.name }));
      onOpenChange(false);
    } else toast.error(ackError(r));
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t("live.tag.title")} description={t("live.tag.body")}>
      <div className="flex flex-col gap-6">
        {methods.includes("mutual") && <PlayerPick players={hiders} onPick={tag} busy={busy} action={t("live.tag.tag")} />}
        {(methods.includes("qr") || methods.includes("code")) && (
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">{t("live.tag.orScan")}</h3>
            <ScanOrCode match={match} qr={methods.includes("qr")} code={methods.includes("code")} onDone={() => onOpenChange(false)} />
          </section>
        )}
      </div>
    </Sheet>
  );
}

/** Hider: rotating QR + 6-digit code (also used to be rescued by QR). */
export function ShowCodeSheet({ open, onOpenChange, match, rescue }: { open: boolean; onOpenChange: (o: boolean) => void; match: UseMatch; rescue?: boolean }) {
  const now = useServerNow(500);
  const qr = match.qr;
  const expired = !qr || qr.expiresAt <= now;
  const { send } = match;
  useEffect(() => {
    if (open && expired) void send({ t: "qrToken" });
  }, [open, expired, send]);
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={rescue ? t("live.qr.rescueTitle") : t("live.qr.showTitle")} description={rescue ? t("live.qr.rescueBody") : t("live.qr.showBody")}>
      <div className="flex flex-col items-center gap-4 pb-2">
        {qr && !expired ? <QrCode value={qr.token} label={t("live.qr.qrLabel")} size={220} /> : <div className="size-[244px] animate-pulse rounded-2xl bg-muted" />}
        <p className="font-mono text-4xl font-semibold tracking-[0.2em] tabular" aria-live="polite">
          {qr && !expired ? `${qr.code.slice(0, 3)} ${qr.code.slice(3)}` : "––– –––"}
        </p>
        <p className="text-sm text-muted-foreground tabular">{qr && !expired ? t("live.qr.refreshIn", { time: formatClock(qr.expiresAt - now) }) : t("common.loading")}</p>
      </div>
    </Sheet>
  );
}

/** Server prompts: a hider confirms or disputes a tag; a jailed player confirms a rescue. */
export function PromptSheet({ match }: { match: UseMatch }) {
  const now = useServerNow(500);
  const p = match.prompt;
  const [busy, setBusy] = useState(false);
  const expired = !!p && p.expiresAt <= now;
  const { clearPrompt } = match;
  useEffect(() => {
    if (expired) clearPrompt();
  }, [expired, clearPrompt]);
  useEffect(() => {
    if (p) vibrate([60, 60, 60]);
  }, [p]);
  if (!p) return null;
  async function reply(accept: boolean) {
    if (!p) return;
    setBusy(true);
    const r = p.kind === "tagRequest" ? await match.send({ t: "tagReply", captureId: p.captureId, accept }) : await match.send({ t: "rescueReply", rescuerId: p.rescuerId, accept });
    setBusy(false);
    match.clearPrompt();
    if (!r.ok) toast.error(ackError(r));
  }
  const tag = p.kind === "tagRequest";
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && match.clearPrompt()}
      title={tag ? t("live.prompt.tagTitle", { name: p.seekerName }) : t("live.prompt.rescueTitle", { name: p.rescuerName })}
      description={tag ? t("live.prompt.tagBody") : t("live.prompt.rescueBody")}
      footer={
        <>
          <Button size="lg" onClick={() => reply(true)} disabled={busy}>
            {tag ? t("live.prompt.confirm") : t("live.prompt.accept")}
          </Button>
          <Button size="lg" variant="outline" onClick={() => reply(false)} disabled={busy}>
            {tag ? t("live.prompt.dispute") : t("live.prompt.decline")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {tag && p.hint === "far" && (
          <p role="note" className="flex gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
            {t("live.prompt.far")}
          </p>
        )}
        <p className="text-sm text-muted-foreground tabular" aria-live="off">
          {t("live.prompt.expires", { time: formatClock(p.expiresAt - now) })}
        </p>
      </div>
    </Sheet>
  );
}

/** Free hider rescues a jailed teammate: ask them to confirm, or scan their code. */
export function RescueSheet({ open, onOpenChange, view, match }: { open: boolean; onOpenChange: (o: boolean) => void; view: MatchView; match: UseMatch }) {
  const [busy, setBusy] = useState<string | null>(null);
  const jailed = view.players.filter((p) => p.status === "jailed" && p.userId !== view.me?.userId);
  const method = view.settings.jail.rescue.method;
  async function rescue(p: ViewPlayer) {
    setBusy(p.userId);
    const r = await match.send({ t: "rescue", jailedId: p.userId });
    setBusy(null);
    if (r.ok) {
      toast(t("live.rescue.waiting", { name: p.name }));
      onOpenChange(false);
    } else toast.error(ackError(r));
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t("live.rescue.title")} description={method === "qr" ? t("live.rescue.bodyQr") : t("live.rescue.bodyConfirm", { left: view.me?.rescuesLeft ?? 0 })}>
      {method === "qr" ? <ScanOrCode match={match} qr code onDone={() => onOpenChange(false)} /> : <PlayerPick players={jailed} onPick={rescue} busy={busy} action={t("live.rescue.action")} />}
    </Sheet>
  );
}
