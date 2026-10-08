import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useSyncExternalStore } from "react";
import { SiteHeader } from "@/components/site-header";
import { AdminDashboard } from "@/components/admin-dashboard";
import { AdminLogin } from "@/components/admin-login";
import {
  getAdminServerSnapshot,
  getAdminSnapshot,
  restoreAdminSession,
  subscribeAdmin,
} from "@/lib/admin";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Ադմինիստրատոր — Արի Գնանք" },
      {
        name: "description",
        content: "Տուրերի, անձնակազմի, ամրագրումների և կայքի կարգավորումների կառավարում։",
      },
    ],
  }),
  component: AdminPage,
});

function AdminPage() {
  const catalog = useSyncExternalStore(subscribeAdmin, getAdminSnapshot, getAdminServerSnapshot);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    restoreAdminSession().finally(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      {!ready ? (
        <p className="px-4 py-16 text-center text-sm text-muted-foreground">Բեռնվում է...</p>
      ) : catalog.session?.role === "admin" ? (
        <AdminDashboard session={catalog.session} />
      ) : (
        <AdminLogin />
      )}
    </div>
  );
}
