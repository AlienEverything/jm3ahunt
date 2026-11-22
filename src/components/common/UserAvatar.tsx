import type { Avatar } from "@/shared";
import { cn } from "@/lib/utils";

const SIZES = { sm: "size-8 text-base", md: "size-10 text-lg", lg: "size-14 text-2xl", xl: "size-20 text-4xl" } as const;

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const chars = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : [parts[0] ?? "?"];
  return chars.map((p) => Array.from(p)[0] ?? "").join("").toUpperCase() || "?";
}

/** Emoji (or initials) on a circle tinted with the player's colour. */
export function UserAvatar({ avatar, name, size = "md", className }: { avatar?: Avatar | null; name: string; size?: keyof typeof SIZES; className?: string }) {
  const color = avatar?.color ?? "#8a8f98";
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-semibold select-none", SIZES[size], className)}
      style={{
        backgroundColor: `color-mix(in oklch, ${color} 20%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in oklch, ${color} 40%, transparent)`,
        color,
      }}
    >
      {avatar?.emoji ? <span className="leading-none">{avatar.emoji}</span> : <span className="text-[0.8em] leading-none">{initials(name)}</span>}
    </span>
  );
}
