"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Page, StickyFooter, TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";
import { api, errorMessage, safeNext } from "@/lib/api";

export function SignInScreen() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/auth/login", { body: { username: username.trim().toLowerCase(), password }, redirectOn401: false });
      router.replace(next);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <>
      <TopBar title={t("auth.signIn")} back="/" />
      <Page>
        <form id="signin-form" onSubmit={submit} className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h2 className="text-2xl font-semibold tracking-tight">{t("signin.heading")}</h2>
            <p className="text-muted-foreground">{t("signin.body")}</p>
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor="username" className="text-sm font-medium">
              {t("auth.username")}
            </label>
            <Input id="username" name="username" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} required value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor="password" className="text-sm font-medium">
              {t("auth.password")}
            </label>
            <Input id="password" name="password" type="password" autoComplete="current-password" required enterKeyHint="go" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {error && (
            <p role="alert" className="text-sm font-medium text-danger">
              {error}
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            {t("signin.newHere")}{" "}
            <Link href={`/start?next=${encodeURIComponent(next)}`} className="font-medium text-foreground underline underline-offset-4">
              {t("signin.playAsGuest")}
            </Link>
          </p>
        </form>
      </Page>
      <StickyFooter>
        <Button type="submit" form="signin-form" size="lg" className="flex-1" disabled={busy || !username || !password}>
          {busy ? t("common.signingIn") : t("auth.signIn")}
        </Button>
      </StickyFooter>
    </>
  );
}
