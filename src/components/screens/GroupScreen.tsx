"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { LogOut, Play, Plus, Settings2 } from "lucide-react";
import { toast } from "sonner";
import type { GroupDetailDto, MeDto } from "@/shared";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { EmptyState, ErrorState, LoadingState, Section } from "@/components/common/States";
import { GroupSettingsSheet } from "@/components/group/GroupSettingsSheet";
import { InvitePanel } from "@/components/group/InvitePanel";
import { MembersList } from "@/components/group/MembersList";
import { QuickStart, SavedPresets, setupUrl } from "@/components/group/PresetSections";
import { Page, StickyFooter, TopBar } from "@/components/layout/TopBar";
import { CurrentMatchCard, ResultList } from "@/components/match/MatchBits";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { api, errorMessage, useApiQuery } from "@/lib/api";
import { formatJoinCode } from "@/lib/hooks";

const TERMINAL = ["finished", "archived"];

export function GroupScreen() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const q = useApiQuery<GroupDetailDto>(`/groups/${encodeURIComponent(id)}`);
  const me = useApiQuery<MeDto>("/me");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const g = q.data;
  const canManage = g?.myRole === "owner" || g?.myRole === "admin";

  async function leave() {
    try {
      await api(`/groups/${id}/leave`, { body: {} });
      toast.success(t("group.left"));
      router.replace("/dashboard");
    } catch (e) {
      toast.error(errorMessage(e));
      throw e;
    }
  }

  return (
    <>
      <TopBar
        title={g?.name ?? t("group.title")}
        back="/dashboard"
        actions={
          canManage && (
            <Button variant="ghost" size="icon" onClick={() => setSettingsOpen(true)} aria-label={t("group.settings.title")}>
              <Settings2 aria-hidden />
            </Button>
          )
        }
      />
      <Page>
        {q.loading && !g && <LoadingState rows={4} />}
        {q.error && !g && <ErrorState error={q.error} onRetry={q.reload} />}
        {g && (
          <>
            <header className="flex items-center gap-4">
              <span aria-hidden className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-muted text-4xl">
                {g.icon}
              </span>
              <div className="flex min-w-0 flex-col gap-1">
                <h2 className="text-2xl font-semibold tracking-tight break-words">{g.name}</h2>
                <p className="text-sm text-muted-foreground">
                  {t(g.members.length === 1 ? "group.memberCountOne" : "group.memberCount", { count: g.members.length })}
                  {g.joinCode && (
                    <>
                      {" · "}
                      {t("group.codeInline")} <span className="font-mono tabular">{formatJoinCode(g.joinCode)}</span>
                    </>
                  )}
                </p>
              </div>
            </header>

            {g.currentMatch && (
              <Section title={t("group.currentMatch")}>
                <CurrentMatchCard match={g.currentMatch} />
              </Section>
            )}

            {canManage && (
              <Section title={t("group.quickStart.title")}>
                <QuickStart groupId={g.id} disabled={!!g.currentMatch} />
                {g.currentMatch && <p className="text-sm text-muted-foreground">{t("group.quickStart.busy")}</p>}
              </Section>
            )}

            {(g.presets.length > 0 || canManage) && (
              <Section title={t("group.presets.title")}>
                {g.presets.length === 0 ? (
                  <EmptyState title={t("group.presets.empty")} body={t("group.presets.emptyBody")} />
                ) : (
                  <SavedPresets groupId={g.id} presets={g.presets} canManage={canManage} onChanged={q.reload} />
                )}
              </Section>
            )}

            <Section title={t("group.members.title", { count: g.members.length })}>
              <MembersList groupId={g.id} members={g.members} myRole={g.myRole} myId={me.data?.user.id} onChanged={q.reload} />
            </Section>

            {canManage && g.inviteToken && g.joinCode && (
              <Section title={t("group.invite.title")}>
                <InvitePanel groupId={g.id} groupName={g.name} inviteToken={g.inviteToken} joinCode={g.joinCode} onRegenerated={q.reload} />
              </Section>
            )}

            <Section title={t("group.history")}>
              {g.recentMatches.filter((m) => TERMINAL.includes(m.state)).length === 0 ? (
                <EmptyState title={t("group.noHistory")} body={t("group.noHistoryBody")} />
              ) : (
                <ResultList matches={g.recentMatches.filter((m) => TERMINAL.includes(m.state))} />
              )}
            </Section>

            <Button variant="ghost" className="self-start text-danger" onClick={() => setLeaving(true)}>
              <LogOut aria-hidden />
              {t("group.leave")}
            </Button>

            {canManage && <GroupSettingsSheet key={`${g.name}${g.icon}${g.maxMembers}${g.hasPassword}`} group={g} open={settingsOpen} onOpenChange={setSettingsOpen} onSaved={q.reload} />}
            <ConfirmDialog
              open={leaving}
              onOpenChange={setLeaving}
              title={t("group.leaveTitle", { name: g.name })}
              body={g.myRole === "owner" ? t("group.leaveOwnerBody") : t("group.leaveBody")}
              confirmLabel={t("group.leave")}
              destructive
              onConfirm={leave}
            />
          </>
        )}
      </Page>
      {g && (g.currentMatch || canManage) && (
        <StickyFooter>
          {g.currentMatch ? (
            <Button size="lg" className="flex-1" render={<Link href={`/matches/${g.currentMatch.id}`} />} nativeButton={false}>
              <Play aria-hidden />
              {t("group.openMatch")}
            </Button>
          ) : (
            <Button size="lg" className="flex-1" render={<Link href={setupUrl(g.id)} />} nativeButton={false}>
              <Plus aria-hidden />
              {t("group.newMatch")}
            </Button>
          )}
        </StickyFooter>
      )}
    </>
  );
}
