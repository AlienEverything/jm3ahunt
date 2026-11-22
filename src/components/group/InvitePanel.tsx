"use client";

import { useState, useSyncExternalStore } from "react";
import { RefreshCw, Share2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { CopyButton } from "@/components/common/CopyButton";
import { QrCode } from "@/components/common/QrCode";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { formatJoinCode } from "@/lib/hooks";

const noop = () => () => {};
const useOrigin = () => useSyncExternalStore(noop, () => window.location.origin, () => "");
const useCanShare = () => useSyncExternalStore(noop, () => typeof navigator.share === "function", () => false);

/** Owner/admin only: link, QR, code, regenerate. */
export function InvitePanel({ groupId, groupName, inviteToken, joinCode, onRegenerated }: { groupId: string; groupName: string; inviteToken: string; joinCode: string; onRegenerated: () => void }) {
  const origin = useOrigin();
  const canShare = useCanShare();
  const [confirm, setConfirm] = useState(false);
  const url = `${origin}/invite/${inviteToken}`;
  const code = formatJoinCode(joinCode);

  async function regenerate() {
    try {
      await api(`/groups/${groupId}/regenerate-codes`, { body: {} });
      toast.success(t("group.invite.regenerated"));
      onRegenerated();
    } catch (e) {
      toast.error(errorMessage(e));
      throw e;
    }
  }

  return (
    <div className="flex flex-col gap-5 rounded-2xl border bg-card p-4 sm:flex-row sm:items-start">
      <div className="flex justify-center">{origin && <QrCode value={url} label={t("group.invite.qrLabel", { name: groupName })} size={168} />}</div>
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t("group.invite.code")}</span>
          <div className="flex items-center gap-2">
            <span className="font-mono text-2xl font-semibold tracking-[0.15em] tabular select-all">{code}</span>
            <CopyButton value={code} label={t("group.invite.copyCode")} size="icon" variant="ghost" />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t("group.invite.link")}</span>
          <span className="truncate font-mono text-sm text-muted-foreground select-all">{url}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <CopyButton value={url} label={t("group.invite.copyLink")} variant="secondary" />
          {canShare && (
            <Button variant="outline" onClick={() => navigator.share({ title: groupName, text: t("group.invite.shareText", { name: groupName }), url }).catch(() => {})}>
              <Share2 aria-hidden />
              {t("group.invite.share")}
            </Button>
          )}
          <Button variant="ghost" onClick={() => setConfirm(true)}>
            <RefreshCw aria-hidden />
            {t("group.invite.regenerate")}
          </Button>
        </div>
      </div>
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title={t("group.invite.regenerateTitle")} body={t("group.invite.regenerateBody")} confirmLabel={t("group.invite.regenerate")} onConfirm={regenerate} />
    </div>
  );
}
