"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import type { GroupDetailDto, MatchInfoDto } from "@/shared";
import { EmptyState, ErrorState, LoadingState } from "@/components/common/States";
import { Page, TopBar } from "@/components/layout/TopBar";
import { MatchSetup } from "@/components/settings/MatchSetup";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { useApiQuery } from "@/lib/api";

export function NewMatchScreen() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const group = useApiQuery<GroupDetailDto>(`/groups/${encodeURIComponent(id)}`);
  const g = group.data;
  const zonesPreset = g?.presets.find((p) => p.id === search.get("zones"));
  const initialZones = zonesPreset && "zones" in zonesPreset.data ? zonesPreset.data.zones : [];

  return (
    <>
      <TopBar title={t("setup.newTitle")} back={`/groups/${id}`} wide />
      <Page wide>
        {group.loading && !g && <LoadingState rows={5} />}
        {group.error && !g && <ErrorState error={group.error} onRetry={group.reload} />}
        {g &&
          (g.currentMatch ? (
            <EmptyState
              title={t("setup.busyTitle")}
              body={t("group.quickStart.busy")}
              action={
                <Button render={<Link href={`/matches/${g.currentMatch.id}`} />} nativeButton={false}>
                  {t("group.openMatch")}
                </Button>
              }
            />
          ) : (
            <MatchSetup groupId={g.id} presets={g.presets} initialPresetId={search.get("preset")} initialZones={initialZones} />
          ))}
      </Page>
    </>
  );
}

export function EditMatchScreen() {
  const { id } = useParams<{ id: string }>();
  const match = useApiQuery<MatchInfoDto>(`/matches/${encodeURIComponent(id)}`);
  const m = match.data;
  const group = useApiQuery<GroupDetailDto>(m ? `/groups/${encodeURIComponent(m.groupId)}` : null);
  const editable = m && m.canManage && (m.state === "draft" || m.state === "lobby");

  return (
    <>
      <TopBar title={t("setup.editTitle")} back={`/matches/${id}`} wide />
      <Page wide>
        {(match.loading || group.loading) && !(m && group.data) && !match.error && <LoadingState rows={5} />}
        {match.error && !m && <ErrorState error={match.error} onRetry={match.reload} />}
        {m && !editable && <EmptyState title={t("setup.notEditable")} body={t("setup.notEditableBody")} />}
        {m && editable && group.data && <MatchSetup groupId={m.groupId} presets={group.data.presets} editMatch={m} />}
      </Page>
    </>
  );
}
