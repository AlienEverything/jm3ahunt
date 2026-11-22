"use client";

import Link from "next/link";
import { ChevronRight, Plus, Users } from "lucide-react";
import type { MeDto } from "@/shared";
import { JoinCodeForm } from "@/components/common/JoinCodeForm";
import { EmptyState, ErrorState, LoadingState, Section } from "@/components/common/States";
import { UserAvatar } from "@/components/common/UserAvatar";
import { Page, StickyFooter, TopBar } from "@/components/layout/TopBar";
import { CurrentMatchCard, ResultList, StateBadge } from "@/components/match/MatchBits";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { useApiQuery } from "@/lib/api";

export function DashboardScreen() {
  const me = useApiQuery<MeDto>("/me");
  const d = me.data;
  const groupName = (id: string) => d?.groups.find((g) => g.id === id)?.name;

  return (
    <>
      <TopBar
        title={t("dashboard.title")}
        actions={
          d && (
            <Button variant="ghost" size="icon" render={<Link href="/account" />} nativeButton={false} aria-label={t("account.title")}>
              <UserAvatar avatar={d.user.avatar} name={d.user.displayName} size="sm" />
            </Button>
          )
        }
      />
      <Page>
        {me.loading && !d && <LoadingState rows={4} />}
        {me.error && !d && <ErrorState error={me.error} onRetry={me.reload} />}
        {d && (
          <>
            <div className="flex flex-col gap-1">
              <h2 className="text-2xl font-semibold tracking-tight text-balance break-words">{t("dashboard.hello", { name: d.user.displayName })}</h2>
              {!d.user.username && (
                <p className="text-sm text-muted-foreground">
                  {t("dashboard.guestNote")}{" "}
                  <Link href="/account" className="font-medium text-foreground underline underline-offset-4">
                    {t("account.saveAccount")}
                  </Link>
                </p>
              )}
            </div>

            {d.activeMatches.length > 0 && (
              <Section title={t("dashboard.activeMatches")}>
                <div className="flex flex-col gap-2">
                  {d.activeMatches.map((m) => (
                    <CurrentMatchCard key={m.id} match={m} groupName={groupName(m.groupId)} />
                  ))}
                </div>
              </Section>
            )}

            <Section title={t("dashboard.groups")}>
              {d.groups.length === 0 ? (
                <EmptyState icon={<Users />} title={t("dashboard.noGroups")} body={t("dashboard.noGroupsBody")} />
              ) : (
                <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
                  {d.groups.map((g) => (
                    <li key={g.id}>
                      <Link href={`/groups/${g.id}`} className="flex min-h-16 items-center gap-3 px-4 py-3 outline-none hover:bg-muted/60 focus-visible:bg-muted">
                        <span aria-hidden className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-muted text-2xl">
                          {g.icon}
                        </span>
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="truncate font-medium">{g.name}</span>
                          <span className="truncate text-sm text-muted-foreground">
                            {t(g.memberCount === 1 ? "group.memberCountOne" : "group.memberCount", { count: g.memberCount })}
                            {g.myRole !== "member" && ` · ${t(`group.roles.${g.myRole}`)}`}
                          </span>
                        </div>
                        {g.activeMatch && <StateBadge state={g.activeMatch.state} />}
                        <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground rtl:rotate-180" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title={t("dashboard.joinByCode")}>
              <JoinCodeForm />
            </Section>

            <Section title={t("dashboard.recentResults")}>
              {d.recentResults.length === 0 ? <EmptyState title={t("dashboard.noResults")} body={t("dashboard.noResultsBody")} /> : <ResultList matches={d.recentResults} showGroup />}
            </Section>
          </>
        )}
      </Page>
      {d && (
        <StickyFooter>
          <Button size="lg" className="flex-1" render={<Link href="/groups/new" />} nativeButton={false}>
            <Plus aria-hidden />
            {t("dashboard.createGroup")}
          </Button>
        </StickyFooter>
      )}
    </>
  );
}
