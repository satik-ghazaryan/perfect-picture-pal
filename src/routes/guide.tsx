import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useSyncExternalStore } from "react";
import { SiteHeader } from "@/components/site-header";
import { GuideDashboard } from "@/components/guide-dashboard";
import { GuideLogin } from "@/components/guide-login";
import {
  getPortalServerSnapshot,
  getPortalSnapshot,
  restoreGuideSession,
  subscribePortal,
} from "@/lib/guide-api";

export const Route = createFileRoute("/guide")({
  head: () => ({
    meta: [
      { title: "Ուղեկցորդի պորտալ — Արի Գնանք" },
      {
        name: "description",
        content: "Ուղեկցորդների և վարորդների մուտք, ուղևորացուցակ և QR գրանցում։",
      },
    ],
  }),
  component: GuidePage,
});

function GuidePage() {
  const portal = useSyncExternalStore(subscribePortal, getPortalSnapshot, getPortalServerSnapshot);
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState("");

  useEffect(() => {
    let cancelled = false;
    restoreGuideSession()
      .catch((error: unknown) => {
        if (!cancelled) {
          setBootError(error instanceof Error ? error.message : "Մուտքը չվերականգնվեց։");
        }
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader showBack />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-10">
        {!ready && (
          <div className="mx-auto min-h-80 max-w-md rounded-3xl border border-border bg-card p-6">
            <p className="text-sm font-semibold text-muted-foreground">Բեռնվում է...</p>
          </div>
        )}
        {ready && bootError && (
          <p className="mb-4 rounded-2xl bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
            {bootError}
          </p>
        )}
        {ready && !portal.profile && <GuideLogin />}
        {ready && portal.profile && <GuideDashboard profile={portal.profile} />}
      </main>
    </div>
  );
}
