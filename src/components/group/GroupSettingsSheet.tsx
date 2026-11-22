"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { GroupDetailDto, PatchGroupBody } from "@/shared";
import { Sheet } from "@/components/common/Sheet";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { GroupFields, groupDraftError, type GroupDraft } from "./GroupForm";

export function GroupSettingsSheet({ group, open, onOpenChange, onSaved }: { group: GroupDetailDto; open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => void }) {
  const [draft, setDraft] = useState<GroupDraft>({ name: group.name, icon: group.icon, usePassword: group.hasPassword, password: "", maxMembers: group.maxMembers });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const problem = groupDraftError(draft, true, group.hasPassword);
    if (problem) return setError(problem);
    const body: PatchGroupBody = { name: draft.name.trim(), icon: draft.icon, maxMembers: Math.min(50, Math.max(2, draft.maxMembers || 2)) };
    if (!draft.usePassword && group.hasPassword) body.password = null;
    else if (draft.usePassword && draft.password) body.password = draft.password;
    setBusy(true);
    setError(null);
    try {
      await api(`/groups/${group.id}`, { method: "PATCH", body });
      toast.success(t("group.settings.saved"));
      onSaved();
      onOpenChange(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("group.settings.title")}
      footer={
        <Button onClick={save} disabled={busy}>
          {busy ? t("common.saving") : t("common.save")}
        </Button>
      }
    >
      <div className="flex flex-col gap-4 pt-1">
        <GroupFields value={draft} onChange={setDraft} editing hasPassword={group.hasPassword} />
        {error && (
          <p role="alert" className="text-sm font-medium text-danger">
            {error}
          </p>
        )}
      </div>
    </Sheet>
  );
}
