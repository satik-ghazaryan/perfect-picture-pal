import { useEffect, useSyncExternalStore } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { SiteHeader } from "@/components/site-header";
import { TouristAuthForm } from "@/components/tourist-auth";
import {
  getTouristServerSnapshot,
  getTouristSnapshot,
  hydrateAdmin,
  subscribeTourist,
} from "@/lib/admin";

function safeRedirect(value: unknown) {
  if (typeof value !== "string") return "/";
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("://") || value.startsWith("/login")) {
    return "/";
  }
  return value;
}

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): { redirect: string } => ({
    redirect: safeRedirect(search["redirect"]),
  }),
  head: () => ({
    meta: [
      { title: "Մուտք — Արի Գնանք" },
      { name: "description", content: "Զբոսաշրջիկի մուտք և գրանցում Արի Գնանք մեկօրյա տուրերի համար։" },
    ],
  }),
  component: LoginPage,
});

function isGuideRedirect(value: string) {
  return value === "/guide" || value.startsWith("/guide/") || value.startsWith("/guide?");
}

function isDriverRedirect(value: string) {
  return value === "/driver" || value.startsWith("/driver/") || value.startsWith("/driver?");
}

function destination(role: "tourist" | "guide" | "driver" | undefined, redirect: string) {
  if (role === "guide") return "/guide";
  if (role === "driver") return "/driver";
  if (role === "tourist") {
    if (isGuideRedirect(redirect) || isDriverRedirect(redirect) || redirect === "/admin") return "/";
    return redirect;
  }
  if (isGuideRedirect(redirect)) return "/guide";
  if (isDriverRedirect(redirect)) return "/driver";
  return redirect;
}

function LoginPage() {
  const { redirect } = Route.useSearch();
  const navigate = useNavigate();
  const tourist = useSyncExternalStore(subscribeTourist, getTouristSnapshot, getTouristServerSnapshot);
  const guideEntry = isGuideRedirect(redirect);
  const driverEntry = isDriverRedirect(redirect);

  useEffect(() => {
    hydrateAdmin();
  }, []);

  useEffect(() => {
    if (!tourist) return;
    void navigate({ href: destination(tourist.role, redirect) });
  }, [tourist, navigate, redirect]);

  const go = () => {
    const session = getTouristSnapshot();
    void navigate({ href: destination(session?.role, redirect) });
  };

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-lg px-4 py-8 sm:px-6">
        <TouristAuthForm
          loginTitle={guideEntry ? "Զբոսավարի մուտք" : driverEntry ? "Վարորդի մուտք" : "Մուտք համակարգ"}
          onSuccess={go}
        />
      </main>
    </div>
  );
}
