"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CreateGroupBody, MeDto } from "@/shared";
import { GROUP_ICONS } from "@/components/common/AvatarPicker";
import { GroupFields, groupDraftError, type GroupDraft } from "@/components/group/GroupForm";
import { Page, StickyFooter, TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { api, errorMessage, useApiQuery } from "@/lib/api";

export function NewGroupScreen() {
  const router = useRouter();
  useApiQuery<MeDto>("/me"); // signed-in check: redirects to onboarding on 401
  const [draft, setDraft] = useState<GroupDraft>({ name: "", icon: GROUP_ICONS[0], usePassword: false, password: "", maxMembers: 15 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const problem = groupDraftError(draft, false, false);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    const body: CreateGroupBody = { name: draft.name.trim(), icon: draft.icon, maxMembers: Math.min(50, Math.max(2, draft.maxMembers || 2)), ...(draft.usePassword ? { password: draft.password } : {}) };
    try {
      const g = await api<{ id: string }>("/groups", { body });
      router.replace(`/groups/${g.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <>
      <TopBar title={t("group.newTitle")} back="/dashboard" />
      <Page>
        <form id="new-group" onSubmit={submit} className="flex flex-col gap-6" noValidate>
          <GroupFields value={draft} onChange={setDraft} />
          {error && (
            <p role="alert" className="text-sm font-medium text-danger">
              {error}
            </p>
          )}
        </form>
      </Page>
      <StickyFooter>
        <Button type="submit" form="new-group" size="lg" className="flex-1" disabled={busy}>
          {busy ? t("common.creating") : t("group.create")}
        </Button>
      </StickyFooter>
    </>
  );
}
