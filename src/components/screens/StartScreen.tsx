"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { MeDto } from "@/shared";
import { AVATAR_COLORS, AVATAR_EMOJIS } from "@/components/common/AvatarPicker";
import { ProfileFields, type ProfileDraft } from "@/components/common/ProfileFields";
import { Page, StickyFooter, TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { api, errorMessage, safeNext } from "@/lib/api";

const pick = <T,>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)];

/** Guest onboarding: name + avatar, then back to `next`. */
export function StartScreen() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const [draft, setDraft] = useState<ProfileDraft>(() => ({ displayName: "", avatarEmoji: AVATAR_EMOJIS[0], avatarColor: AVATAR_COLORS[0] }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Random starting avatar after hydration (keeps server and client HTML equal).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft((d) => ({ ...d, avatarEmoji: pick(AVATAR_EMOJIS), avatarColor: pick(AVATAR_COLORS) }));
    // Already signed in: skip onboarding.
    api<MeDto>("/me", { redirectOn401: false })
      .then(() => router.replace(next))
      .catch(() => {});
  }, [router, next]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const displayName = draft.displayName.trim();
    if (!displayName) {
      setError(t("profile.nameRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api("/auth/guest", { body: { displayName } });
      await api("/me", { method: "PATCH", body: { avatarEmoji: draft.avatarEmoji, avatarColor: draft.avatarColor } });
      router.replace(next);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <>
      <TopBar title={t("start.title")} back="/" />
      <Page>
        <form id="start-form" onSubmit={submit} className="flex flex-col gap-8" noValidate>
          <div className="flex flex-col gap-2">
            <h2 className="text-2xl font-semibold tracking-tight text-balance">{t("start.heading")}</h2>
            <p className="text-muted-foreground">{t("start.body")}</p>
          </div>
          <ProfileFields value={draft} onChange={setDraft} />
          {error && (
            <p role="alert" className="text-sm font-medium text-danger">
              {error}
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            {t("start.haveAccount")}{" "}
            <Link href={`/signin?next=${encodeURIComponent(next)}`} className="font-medium text-foreground underline underline-offset-4">
              {t("auth.signIn")}
            </Link>
          </p>
        </form>
      </Page>
      <StickyFooter>
        <Button type="submit" form="start-form" size="lg" className="flex-1" disabled={busy}>
          {busy ? t("common.saving") : t("start.submit")}
        </Button>
      </StickyFooter>
    </>
  );
}
