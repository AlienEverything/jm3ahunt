import type { ReactNode } from "react";
import { CircleCheck, Circle } from "lucide-react";
import type { Presence, Role, ViewPlayer } from "@/shared";
import { UserAvatar } from "@/components/common/UserAvatar";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";

export function RoleChip({ role, className }: { role: Role; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-full px-2.5 text-xs font-semibold",
        role === "seeker" ? "bg-seeker/12 text-seeker-ink" : "bg-hider/14 text-hider-ink",
        className,
      )}
    >
      {t(`roles.${role}`)}
    </span>
  );
}

const PRESENCE_DOT: Record<Presence, string> = { online: "bg-success", stale: "bg-warning", offline: "bg-muted-foreground/50" };

export function PresenceDot({ presence }: { presence: Presence }) {
  return (
    <span className="absolute -end-0.5 -bottom-0.5 flex size-3.5 items-center justify-center rounded-full bg-card">
      <span className={cn("size-2.5 rounded-full", PRESENCE_DOT[presence])} />
      <span className="sr-only">{t(`presence.${presence}`)}</span>
    </span>
  );
}

interface PlayerRowProps {
  player: ViewPlayer;
  isMe?: boolean;
  /** Hide roles (random assignment: nobody knows roles in the lobby). */
  showRole?: boolean;
  showReady?: boolean;
  /** Status line under the name (e.g. jailed). */
  detail?: string;
  /** Inline controls under the name (e.g. host role picker). */
  controls?: ReactNode;
  actions?: ReactNode;
}

export function PlayerRow({ player, isMe, showRole = true, showReady = false, detail, controls, actions }: PlayerRowProps) {
  return (
    <li className="flex min-h-16 items-center gap-3 px-4 py-2.5">
      <span className="relative">
        <UserAvatar avatar={player.avatar} name={player.name} />
        <PresenceDot presence={player.presence} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">{player.name}</span>
          {isMe && <span className="shrink-0 text-xs text-muted-foreground">{t("lobby.you")}</span>}
          {player.isHost && <span className="shrink-0 rounded-md border px-1.5 py-px text-[11px] font-medium text-muted-foreground">{t("lobby.host")}</span>}
        </div>
        {detail && <span className="truncate text-xs text-muted-foreground">{detail}</span>}
        {controls && <div className="mt-1.5">{controls}</div>}
      </div>
      {showRole && player.role && <RoleChip role={player.role} />}
      {showReady &&
        (player.ready ? (
          <CircleCheck className="size-5 shrink-0 text-success" aria-label={t("lobby.ready")} />
        ) : (
          <Circle className="size-5 shrink-0 text-muted-foreground/50" aria-label={t("lobby.notReady")} />
        ))}
      {actions}
    </li>
  );
}
