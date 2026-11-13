import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useSyncExternalStore } from "react";
import { formatAssignedDepartureDate } from "@/lib/calendar-date";
import { SiteHeader } from "@/components/site-header";
import {
  getAdminServerSnapshot,
  getAdminSnapshot,
  ensureAccountRestored,
  getAccountStatus,
  getTouristServerSnapshot,
  getTouristSnapshot,
  subscribeAdmin,
  subscribeTourist,
} from "@/lib/admin";
import {
  getPortalServerSnapshot,
  getPortalSnapshot,
  loadDepartureManifest,
  subscribePortal,
} from "@/lib/guide-api";

export const Route = createFileRoute("/driver")({
  head: () => ({
    meta: [
      { title: "Վարորդի էջ — Արի Գնանք" },
      { name: "description", content: "Վարորդի նշանակված մեկնումները և ուղևորների քանակը։" },
    ],
  }),
  component: DriverPage,
});

function DriverPage() {
  const navigate = useNavigate();
  const session = useSyncExternalStore(
    subscribeTourist,
    getTouristSnapshot,
    getTouristServerSnapshot,
  );
  const accountStatus = useSyncExternalStore(
    subscribeTourist,
    getAccountStatus,
    () => "ready" as const,
  );
  const catalog = useSyncExternalStore(subscribeAdmin, getAdminSnapshot, getAdminServerSnapshot);
  const portal = useSyncExternalStore(subscribePortal, getPortalSnapshot, getPortalServerSnapshot);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    ensureAccountRestored().finally(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready || accountStatus !== "ready") return;
    if (!session) {
      void navigate({ to: "/login", search: { redirect: "/driver" } });
      return;
    }
    if (session.role === "guide") void navigate({ to: "/guide" });
    else if (session.role !== "driver") void navigate({ to: "/" });
  }, [ready, accountStatus, session, navigate]);

  const driverId = session?.role === "driver" ? session.id : "";
  const tours = portal.tours.filter((tour) => tour.driverId === driverId);
  const tourKey = tours.map((tour) => `${tour.id}:${tour.departureDate}`).join("|");

  useEffect(() => {
    if (!driverId) return;
    const assigned = getPortalSnapshot().tours.filter((tour) => tour.driverId === driverId);
    for (const tour of assigned) void loadDepartureManifest(tour.departureId);
  }, [driverId, tourKey]);

  const allowed = ready && accountStatus === "ready" && session?.role === "driver";

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-6 sm:px-6 sm:py-10">
        {!allowed && <p className="text-sm text-muted-foreground">Բեռնվում է...</p>}
        {allowed && (
          <>
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-primary">Վարորդ</p>
              <h1 className="mt-1 text-2xl font-black tracking-tight">{session.fullName}</h1>
            </div>
            {tours.length === 0 ? (
              <p className="rounded-3xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
                Ձեզ տուր դեռ նշանակված չէ։
              </p>
            ) : (
              tours.map((tour) => {
                const details = catalog.tours.find((item) => item.id === tour.id);
                const passengers = portal.bookings.filter(
                  (booking) => booking.departureId === tour.departureId,
                );
                const count = passengers.reduce(
                  (sum, booking) => sum + booking.adults + booking.children,
                  0,
                );
                const when = formatAssignedDepartureDate(tour.departureDate);
                return (
                  <article
                    key={tour.departureId}
                    className="space-y-2 rounded-3xl border border-border bg-card p-4 sm:p-5"
                  >
                    <h2 className="text-lg font-black leading-snug">{tour.title}</h2>
                    <p className="text-sm text-muted-foreground">
                      {when} · մեկնում {tour.departureTime}
                      {details?.returnTime ? ` · վերադարձ ${details.returnTime}` : ""}
                    </p>
                    <p className="text-sm text-muted-foreground">{tour.departurePlace}</p>
                    <p className="text-sm font-semibold">Ուղևորների քանակ՝ {count}</p>
                  </article>
                );
              })
            )}
          </>
        )}
      </main>
    </div>
  );
}
