"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { toast } from "sonner";
import type { MeDto, UserDto } from "@/shared";
import { ProfileFields, type ProfileDraft } from "@/components/common/ProfileFields";
import { ErrorState, LoadingState, Section } from "@/components/common/States";
import { Page, TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";
import { api, errorMessage, useApiQuery } from "@/lib/api";

const USERNAME_RE = /^[a-z0-9_.-]{3,24}$/;

function ProfileForm({ user, onSaved }: { user: UserDto; onSaved: () => void }) {
  const [draft, setDraft] = useState<ProfileDraft>({ displayName: user.displayName, avatarEmoji: user.avatar.emoji, avatarColor: user.avatar.color });
  const [busy, setBusy] = useState(false);
  const dirty = draft.displayName !== user.displayName || draft.avatarEmoji !== user.avatar.emoji || draft.avatarColor !== user.avatar.color;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.displayName.trim()) return toast.error(t("profile.nameRequired"));
    setBusy(true);
    try {
      await api("/me", { method: "PATCH", body: { displayName: draft.displayName.trim(), avatarEmoji: draft.avatarEmoji, avatarColor: draft.avatarColor } });
      toast.success(t("account.profileSaved"));
      onSaved();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-4 rounded-2xl border bg-card p-4">
      <ProfileFields value={draft} onChange={setDraft} />
      <Button type="submit" variant="secondary" disabled={!dirty || busy} className="self-start">
        {busy ? t("common.saving") : t("account.saveProfile")}
      </Button>
    </form>
  );
}

function RegisterForm({ onSaved }: { onSaved: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const normalized = username.trim().toLowerCase();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!USERNAME_RE.test(normalized)) return setError(t("account.usernameRule"));
    if (password.length < 8) return setError(t("account.passwordRule"));
    setBusy(true);
    setError(null);
    try {
      await api("/auth/register", { body: { username: normalized, password } });
      toast.success(t("account.saved"));
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-2xl border bg-card p-4">
      <p className="text-sm text-pretty text-muted-foreground">{t("account.saveBody")}</p>
      <div className="flex flex-col gap-2">
        <label htmlFor="reg-username" className="text-sm font-medium">
          {t("auth.username")}
        </label>
        <Input id="reg-username" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value)} aria-describedby="reg-username-help" />
        <p id="reg-username-help" className="text-xs text-muted-foreground">
          {t("account.usernameRule")}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="reg-password" className="text-sm font-medium">
          {t("auth.password")}
        </label>
        <Input id="reg-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-describedby="reg-password-help" />
        <p id="reg-password-help" className="text-xs text-muted-foreground">
          {t("account.passwordRule")}
        </p>
      </div>
      {error && (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy} className="self-start">
        {busy ? t("common.saving") : t("account.saveAccount")}
      </Button>
    </form>
  );
}

export function AccountScreen() {
  const router = useRouter();
  const me = useApiQuery<MeDto>("/me");
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    try {
      await api("/auth/logout", { body: {}, redirectOn401: false });
    } catch {
      // Signed out locally either way.
    }
    router.replace("/");
  }

  const user = me.data?.user;
  return (
    <>
      <TopBar title={t("account.title")} back="/dashboard" />
      <Page>
        {me.loading && !user && <LoadingState />}
        {me.error && !user && <ErrorState error={me.error} onRetry={me.reload} />}
        {user && (
          <>
            <Section title={t("account.profile")}>
              <ProfileForm key={`${user.displayName}${user.avatar.emoji}${user.avatar.color}`} user={user} onSaved={me.reload} />
            </Section>
            <Section title={t("account.login")}>
              {user.username ? (
                <div className="rounded-2xl border bg-card p-4 text-sm">
                  {t("account.signedInAs")} <span className="font-mono font-medium">@{user.username}</span>
                </div>
              ) : (
                <RegisterForm onSaved={me.reload} />
              )}
            </Section>
            <Section title={t("account.stats")}>
              <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border bg-border sm:grid-cols-5">
                {(["matches", "wins", "captures", "timesCaptured", "rescues"] as const).map((k) => (
                  <div key={k} className="flex flex-col gap-1 bg-card p-4 first:col-span-2 sm:first:col-span-1">
                    <dt className="text-xs text-muted-foreground">{t(`account.statLabels.${k}`)}</dt>
                    <dd className="font-mono text-2xl font-semibold tabular">{user.stats[k]}</dd>
                  </div>
                ))}
              </dl>
            </Section>
            <Button variant="outline" onClick={signOut} disabled={signingOut} className="self-start">
              <LogOut aria-hidden />
              {t("account.signOut")}
            </Button>
            {!user.username && <p className="-mt-6 text-xs text-muted-foreground">{t("account.guestSignOutWarning")}</p>}
          </>
        )}
      </Page>
    </>
  );
}
