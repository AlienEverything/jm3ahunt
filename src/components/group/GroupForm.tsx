"use client";

import { EmojiGrid, GROUP_ICONS } from "@/components/common/AvatarPicker";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { t } from "@/i18n";

export interface GroupDraft {
  name: string;
  icon: string;
  /** Turn the join password on. */
  usePassword: boolean;
  /** New password; empty keeps the current one when editing. */
  password: string;
  maxMembers: number;
}

export const MAX_MEMBERS_LIMIT = 50;

/** Shared by "New group" and the group settings sheet. */
export function GroupFields({ value, onChange, editing, hasPassword }: { value: GroupDraft; onChange: (v: GroupDraft) => void; editing?: boolean; hasPassword?: boolean }) {
  const set = <K extends keyof GroupDraft>(k: K, v: GroupDraft[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <label htmlFor="group-name" className="text-sm font-medium">
          {t("group.form.name")}
        </label>
        <Input id="group-name" maxLength={40} required value={value.name} placeholder={t("group.form.namePlaceholder")} autoComplete="off" onChange={(e) => set("name", e.target.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">{t("group.form.icon")}</span>
        <EmojiGrid options={GROUP_ICONS} value={value.icon} onChange={(v) => set("icon", v)} label={t("group.form.icon")} />
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="group-max" className="text-sm font-medium">
          {t("group.form.maxMembers")}
        </label>
        <Input
          id="group-max"
          type="number"
          inputMode="numeric"
          min={2}
          max={MAX_MEMBERS_LIMIT}
          value={value.maxMembers}
          onChange={(e) => set("maxMembers", Math.round(Number(e.target.value)))}
          // Clamp on blur so typing "12" is not cut off at the first digit.
          onBlur={() => set("maxMembers", Math.min(MAX_MEMBERS_LIMIT, Math.max(2, value.maxMembers || 2)))}
          className="w-28 font-mono tabular"
          aria-describedby="group-max-help"
        />
        <p id="group-max-help" className="text-xs text-muted-foreground">
          {t("group.form.maxMembersHelp")}
        </p>
      </div>
      <div className="flex flex-col gap-3">
        <label className="flex items-start justify-between gap-4">
          <span className="flex flex-col gap-1">
            <span className="text-sm font-medium">{t("group.form.password")}</span>
            <span className="text-sm text-muted-foreground">{t("group.form.passwordHelp")}</span>
          </span>
          <Switch checked={value.usePassword} onCheckedChange={(c) => set("usePassword", c)} className="mt-1" />
        </label>
        {value.usePassword && (
          <Input
            type="password"
            autoComplete="new-password"
            minLength={4}
            maxLength={64}
            aria-label={t("group.form.password")}
            placeholder={editing && hasPassword ? t("group.form.passwordKeep") : t("group.form.passwordPlaceholder")}
            value={value.password}
            onChange={(e) => set("password", e.target.value)}
          />
        )}
      </div>
    </div>
  );
}

/** Returns an i18n error or null. */
export function groupDraftError(d: GroupDraft, editing: boolean, hasPassword: boolean): string | null {
  if (!d.name.trim()) return t("group.form.nameRequired");
  const needsNew = d.usePassword && (!editing || !hasPassword);
  if ((needsNew || d.password) && d.usePassword && d.password.length < 4) return t("group.form.passwordShort");
  return null;
}
