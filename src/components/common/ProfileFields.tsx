"use client";

import { Input } from "@/components/ui/input";
import { t } from "@/i18n";
import { AVATAR_EMOJIS, ColorRow, EmojiGrid } from "./AvatarPicker";
import { UserAvatar } from "./UserAvatar";

export interface ProfileDraft {
  displayName: string;
  avatarEmoji: string;
  avatarColor: string;
}

/** Name + avatar (emoji and colour) with a live preview. */
export function ProfileFields({ value, onChange }: { value: ProfileDraft; onChange: (v: ProfileDraft) => void }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <UserAvatar avatar={{ emoji: value.avatarEmoji, color: value.avatarColor }} name={value.displayName || "?"} size="xl" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <label htmlFor="displayName" className="text-sm font-medium">
            {t("profile.name")}
          </label>
          <Input
            id="displayName"
            name="nickname"
            autoComplete="nickname"
            enterKeyHint="done"
            maxLength={32}
            required
            value={value.displayName}
            placeholder={t("profile.namePlaceholder")}
            onChange={(e) => onChange({ ...value, displayName: e.target.value })}
          />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">{t("profile.emoji")}</span>
        <EmojiGrid options={AVATAR_EMOJIS} value={value.avatarEmoji} onChange={(avatarEmoji) => onChange({ ...value, avatarEmoji })} label={t("profile.emoji")} />
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">{t("profile.color")}</span>
        <ColorRow value={value.avatarColor} onChange={(avatarColor) => onChange({ ...value, avatarColor })} />
      </div>
    </div>
  );
}
