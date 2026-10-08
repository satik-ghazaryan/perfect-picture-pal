import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useSyncExternalStore } from "react";
import { format, parseISO } from "date-fns";
import { hy } from "date-fns/locale";
import { SiteHeader } from "@/components/site-header";
import {
  getAdminServerSnapshot,
  getAdminSnapshot,
  getTouristServerSnapshot,
  getTouristSnapshot,
  hydrateAdmin,
  refreshStoredDirectory,
  subscribeAdmin,
  subscribeTourist,
} from "@/lib/admin";
import {
  getPortalServerSnapshot,
  getPortalSnapshot,
  loadTourManifest,
  subscribePortal,
  upcomingDepartureDate,
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
  const session = useSyncExternalStore(subscribeTourist, getTouristSnapshot, getTouristServerSnapshot);
  const catalog = useSyncExternalStore(subscribeAdmin, getAdminSnapshot, getAdminServerSnapshot);
  const portal = useSyncExternalStore(subscribePortal, getPortalSnapshot, getPortalServerSnapshot);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    hydrateAdmin();
    refreshStoredDirectory();
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (!session) {
      void navigate({ to: "/login", search: { redirect: "/driver" } });
      return;
    }
    if (session.role === "guide") void navigate({ to: "/guide" });
    else if (session.role !== "driver") void navigate({ to: "/" });
  }, [ready, session, navigate]);

  const driverId = session?.role === "driver" ? session.id : "";
  const tours = portal.tours.filter((tour) => tour.driverId === driverId);
  const tourKey = tours.map((tour) => `${tour.id}:${tour.departureDate}`).join("|");

  useEffect(() => {
    if (!driverId) return;
    const assigned = getPortalSnapshot().tours.filter((tour) => tour.driverId === driverId);
    for (const tour of assigned) void loadTourManifest(tour.id, tour.departureDate);
  }, [driverId, tourKey]);

  const allowed = ready && session?.role === "driver";

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
                const passengers = portal.bookings.filter((booking) => booking.tourId === tour.id);
                const count = passengers.reduce((sum, booking) => sum + booking.adults + booking.children, 0);
                const date = parseISO(details ? upcomingDepartureDate(details.day) : tour.departureDate);
                const when = Number.isNaN(date.getTime())
                  ? tour.departureDate
                  : format(date, "d MMMM yyyy", { locale: hy });
                return (
                  <article key={tour.id} className="space-y-2 rounded-3xl border border-border bg-card p-4 sm:p-5">
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
