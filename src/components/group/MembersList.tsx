"use client";

import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import type { GroupRole, MemberDto } from "@/shared";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { UserAvatar } from "@/components/common/UserAvatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { t } from "@/i18n";
import { api, errorMessage } from "@/lib/api";

const RANK: Record<GroupRole, number> = { owner: 0, admin: 1, member: 2 };

/** Owner can promote/demote admins; owner/admin can remove members below them. */
export function MembersList({ groupId, members, myRole, myId, onChanged }: { groupId: string; members: MemberDto[]; myRole: GroupRole; myId?: string; onChanged: () => void }) {
  const [removing, setRemoving] = useState<MemberDto | null>(null);
  const sorted = [...members].sort((a, b) => RANK[a.role] - RANK[b.role] || a.displayName.localeCompare(b.displayName));

  async function setRole(m: MemberDto, role: "admin" | "member") {
    try {
      await api(`/groups/${groupId}/members/${m.userId}`, { method: "PUT", body: { role } });
      toast.success(role === "admin" ? t("group.members.promoted", { name: m.displayName }) : t("group.members.demoted", { name: m.displayName }));
      onChanged();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function remove(m: MemberDto) {
    try {
      await api(`/groups/${groupId}/members/${m.userId}`, { method: "DELETE" });
      toast.success(t("group.members.removed", { name: m.displayName }));
      onChanged();
    } catch (e) {
      toast.error(errorMessage(e));
      throw e;
    }
  }

  return (
    <>
      <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
        {sorted.map((m) => {
          const self = m.userId === myId;
          const canPromote = myRole === "owner" && !self && m.role !== "owner";
          const canRemove = !self && m.role !== "owner" && (myRole === "owner" || (myRole === "admin" && m.role === "member"));
          return (
            <li key={m.userId} className="flex min-h-16 items-center gap-3 px-4 py-2.5">
              <UserAvatar avatar={m.avatar} name={m.displayName} />
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span className="truncate font-medium">{m.displayName}</span>
                {self && <span className="shrink-0 text-xs text-muted-foreground">{t("lobby.you")}</span>}
              </div>
              {m.role !== "member" && <span className="shrink-0 rounded-md border px-1.5 py-px text-[11px] font-medium text-muted-foreground">{t(`group.roles.${m.role}`)}</span>}
              {(canPromote || canRemove) && (
                <DropdownMenu>
                  <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={t("group.members.actionsFor", { name: m.displayName })} />}>
                    <MoreHorizontal aria-hidden />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-52">
                    {canPromote && m.role === "member" && <DropdownMenuItem onClick={() => setRole(m, "admin")}>{t("group.members.makeAdmin")}</DropdownMenuItem>}
                    {canPromote && m.role === "admin" && <DropdownMenuItem onClick={() => setRole(m, "member")}>{t("group.members.removeAdmin")}</DropdownMenuItem>}
                    {canRemove && (
                      <DropdownMenuItem variant="destructive" onClick={() => setRemoving(m)}>
                        {t("group.members.remove")}
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </li>
          );
        })}
      </ul>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t("group.members.removeTitle", { name: removing?.displayName ?? "" })}
        body={t("group.members.removeBody")}
        confirmLabel={t("group.members.remove")}
        destructive
        onConfirm={() => (removing ? remove(removing) : undefined)}
      />
    </>
  );
}
