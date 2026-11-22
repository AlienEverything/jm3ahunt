"use client";

import { cn } from "@/lib/utils";
import { t } from "@/i18n";

export const AVATAR_EMOJIS = ["🦊", "🐺", "🦉", "🐸", "🐙", "🦝", "🐯", "🐼", "🐨", "🦁", "🐵", "🦄", "🐧", "🦖", "👻", "🤖", "👽", "🥷", "🕵️", "🧭"];
export const AVATAR_COLORS = ["#FF5A1F", "#0EA5A4", "#2563EB", "#7C3AED", "#DB2777", "#16A34A", "#CA8A04", "#475569"];
export const GROUP_ICONS = ["🏃", "🌲", "🏙️", "🏫", "🏕️", "🌃", "🎯", "🗺️", "🔦", "⚽", "🎒", "🔥"];

export function EmojiGrid({ options, value, onChange, label }: { options: string[]; value: string; onChange: (v: string) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid grid-cols-6 gap-2 sm:grid-cols-10">
      {options.map((e) => (
        <button
          key={e}
          type="button"
          role="radio"
          aria-checked={value === e}
          aria-label={e}
          onClick={() => onChange(e)}
          className={cn(
            "flex aspect-square min-h-11 items-center justify-center rounded-xl border text-2xl transition-[transform,border-color,background-color] duration-150 ease-out outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-95",
            value === e ? "border-primary bg-primary/10" : "border-transparent bg-muted hover:bg-secondary",
          )}
        >
          {e}
        </button>
      ))}
    </div>
  );
}

export function ColorRow({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div role="radiogroup" aria-label={t("profile.color")} className="grid max-w-md grid-cols-8">
      {AVATAR_COLORS.map((c, i) => {
        const on = value.toLowerCase() === c.toLowerCase();
        return (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={t("profile.colorN", { n: i + 1 })}
            onClick={() => onChange(c)}
            className="flex aspect-square min-h-11 items-center justify-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <span className={cn("size-8 rounded-full ring-offset-2 ring-offset-background transition-shadow duration-150", on && "ring-2 ring-foreground")} style={{ backgroundColor: c }} />
          </button>
        );
      })}
    </div>
  );
}
