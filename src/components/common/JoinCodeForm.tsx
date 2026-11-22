"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";
import { api, ApiError, errorMessage } from "@/lib/api";
import { formatJoinCode } from "@/lib/hooks";

/** Join response: the group (id). Accepts `groupId` too in case the server returns a summary. */
export type JoinResult = { id?: string; groupId?: string };
export const joinedGroupId = (r: JoinResult) => r.groupId ?? r.id ?? null;
/** Server signals a missing or wrong group password with an error code mentioning "password". */
export const needsPasswordError = (e: unknown) => e instanceof ApiError && /password/i.test(e.code);

const INVITE_RE = /\/invite\/([A-Za-z0-9_-]{16,64})/;

/** Join code entry (XXXX-XXXX). A pasted invite link opens its preview instead. */
export function JoinCodeForm({ initialCode = "", autoFocus }: { initialCode?: string; autoFocus?: boolean }) {
  const router = useRouter();
  const [code, setCode] = useState(formatJoinCode(initialCode));
  const [password, setPassword] = useState("");
  const [askPassword, setAskPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const raw = code.replace(/-/g, "");

  function onCodeChange(v: string) {
    const link = v.match(INVITE_RE);
    if (link) {
      router.push(`/invite/${link[1]}`);
      return;
    }
    setCode(formatJoinCode(v));
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (raw.length !== 8) return setError(t("join.codeLength"));
    setBusy(true);
    setError(null);
    try {
      const r = await api<JoinResult>("/groups/join", { body: { codeOrToken: raw, ...(askPassword ? { password } : {}) } });
      const id = joinedGroupId(r);
      router.push(id ? `/groups/${id}` : "/dashboard");
    } catch (err) {
      if (needsPasswordError(err) && !askPassword) {
        setAskPassword(true);
        setError(t("join.passwordNeeded"));
      } else setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label htmlFor="join-code" className="sr-only">
        {t("join.codeLabel")}
      </label>
      <div className="flex gap-2">
        <Input
          id="join-code"
          autoFocus={autoFocus}
          value={code}
          onChange={(e) => onCodeChange(e.target.value)}
          placeholder="XXXX-XXXX"
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          maxLength={64}
          aria-invalid={error && !askPassword ? true : undefined}
          aria-describedby={error ? "join-error" : undefined}
          className="flex-1 font-mono text-lg tracking-[0.2em] uppercase tabular"
        />
        <Button type="submit" variant="secondary" disabled={busy || raw.length < 8}>
          {busy ? t("join.joining") : t("join.submit")}
        </Button>
      </div>
      {askPassword && (
        <div className="flex flex-col gap-2">
          <label htmlFor="join-password" className="text-sm font-medium">
            {t("join.password")}
          </label>
          <Input id="join-password" type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        </div>
      )}
      {error && (
        <p id="join-error" role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
