"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Lock } from "lucide-react";
import type { InvitePreviewDto } from "@/shared";
import { JoinCodeForm, joinedGroupId, needsPasswordError, type JoinResult } from "@/components/common/JoinCodeForm";
import { ErrorState, LoadingState } from "@/components/common/States";
import { Page, StickyFooter, TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";
import { api, errorMessage, useApiQuery } from "@/lib/api";

export function JoinScreen() {
  const code = useSearchParams().get("code") ?? "";
  return (
    <>
      <TopBar title={t("join.title")} back={true} />
      <Page>
        <div className="flex flex-col gap-2">
          <h2 className="text-2xl font-semibold tracking-tight">{t("join.heading")}</h2>
          <p className="text-muted-foreground">{t("join.body")}</p>
        </div>
        <JoinCodeForm initialCode={code} autoFocus />
      </Page>
    </>
  );
}

export function InviteScreen() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  // Public preview: no redirect; joining needs a session and redirects on 401.
  const preview = useApiQuery<InvitePreviewDto>(`/invite/${encodeURIComponent(token)}`, { redirectOn401: false });
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const p = preview.data;

  async function join(e: React.FormEvent) {
    e.preventDefault();
    if (!p) return;
    if (p.alreadyMember) return router.push(`/groups/${p.groupId}`);
    setBusy(true);
    setError(null);
    try {
      const r = await api<JoinResult>("/groups/join", { body: { codeOrToken: token, ...(p.needsPassword ? { password } : {}) } });
      router.push(`/groups/${joinedGroupId(r) ?? p.groupId}`);
    } catch (err) {
      setError(needsPasswordError(err) ? t("join.wrongPassword") : errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <>
      <TopBar title={t("invite.title")} back="/" />
      <Page>
        {preview.loading && !p && <LoadingState rows={1} />}
        {preview.error && !p && <ErrorState error={preview.error} onRetry={preview.reload} />}
        {p && (
          <form id="invite-form" onSubmit={join} className="flex flex-col gap-6">
            <div className="flex flex-col items-center gap-3 rounded-2xl border bg-card px-6 py-8 text-center">
              <span aria-hidden className="flex size-16 items-center justify-center rounded-2xl bg-muted text-4xl">
                {p.icon}
              </span>
              <p className="text-sm text-muted-foreground">{t("invite.invitedTo")}</p>
              <h2 className="max-w-full text-2xl font-semibold tracking-tight break-words">{p.groupName}</h2>
              <p className="text-sm text-muted-foreground">{t(p.memberCount === 1 ? "group.memberCountOne" : "group.memberCount", { count: p.memberCount })}</p>
            </div>
            {p.alreadyMember ? (
              <p className="text-center text-sm text-muted-foreground">{t("invite.alreadyMember")}</p>
            ) : (
              p.needsPassword && (
                <div className="flex flex-col gap-2">
                  <label htmlFor="invite-password" className="flex items-center gap-2 text-sm font-medium">
                    <Lock aria-hidden className="size-4" />
                    {t("join.password")}
                  </label>
                  <Input id="invite-password" type="password" autoComplete="off" required value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
              )
            )}
            {error && (
              <p role="alert" className="text-sm font-medium text-danger">
                {error}
              </p>
            )}
            <p className="text-center text-xs text-muted-foreground">
              {t("invite.privacy")}{" "}
              <Link href="/" className="underline underline-offset-4">
                {t("invite.learnMore")}
              </Link>
            </p>
          </form>
        )}
      </Page>
      {p && (
        <StickyFooter>
          <Button type="submit" form="invite-form" size="lg" className="flex-1" disabled={busy || (p.needsPassword && !p.alreadyMember && !password)}>
            {p.alreadyMember ? t("invite.openGroup") : busy ? t("join.joining") : t("invite.join")}
          </Button>
        </StickyFooter>
      )}
    </>
  );
}
