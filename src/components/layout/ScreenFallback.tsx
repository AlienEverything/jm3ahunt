import { LoadingState } from "@/components/common/States";
import { Page } from "./TopBar";

/** Suspense fallback for client screens (prerendered shell). */
export function ScreenFallback() {
  return (
    <>
      <div className="h-14 pt-safe" aria-hidden />
      <Page>
        <LoadingState rows={3} />
      </Page>
    </>
  );
}
