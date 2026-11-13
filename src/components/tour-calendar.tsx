import { useEffect, useState, useSyncExternalStore } from "react";
import { useNavigate } from "@tanstack/react-router";
import { TourCover } from "@/components/tour-cover";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatAssignedDepartureDate } from "@/lib/calendar-date";
import { upcomingDepartures } from "@/lib/departure-deadline";
import {
  getAdminServerSnapshot,
  getAdminSnapshot,
  hydrateAdmin,
  listLocalDepartures,
  subscribeAdmin,
} from "@/lib/admin";
import { tourTitle, useSiteLocale } from "@/lib/locale";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

type DepartureRow = {
  id: string;
  tourId: string;
  departureDate: string;
  availableSeats: number;
};

export function TourCalendar() {
  const navigate = useNavigate();
  const lang = useSiteLocale();
  const catalog = useSyncExternalStore(subscribeAdmin, getAdminSnapshot, getAdminServerSnapshot);
  const [tab, setTab] = useState("upcoming");
  const [departures, setDepartures] = useState<DepartureRow[] | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    hydrateAdmin();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    let cancelled = false;
    void supabase
      .from("departures")
      .select("id, tour_id, departure_date, available_seats")
      .order("departure_date")
      .then(({ data }) => {
        if (cancelled) return;
        setDepartures(
          (data ?? []).map((row) => ({
            id: row.id,
            tourId: row.tour_id,
            departureDate: row.departure_date,
            availableSeats: row.available_seats,
          })),
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const published =
    catalog.catalogStatus === "loaded"
      ? catalog.tours.filter((tour) => tour.is_virtual_only !== true)
      : [];
  const departureRows = !isSupabaseConfigured || !supabase ? listLocalDepartures() : departures;
  const toursById = new Map(published.map((tour) => [tour.id, tour]));
  const upcoming =
    departureRows === null
      ? null
      : upcomingDepartures(
          departureRows.flatMap((row) => {
            const tour = toursById.get(row.tourId);
            if (!tour) return [];
            return [{ ...row, departureTime: tour.departureTime }];
          }),
          now,
        );
  const upcomingTourIds = new Set((upcoming ?? []).map((row) => row.tourId));
  const loading = catalog.catalogStatus !== "loaded" || upcoming === null;

  return (
    <section id="calendar" className="mx-auto max-w-7xl px-4 pt-12 sm:px-6">
      <h2 className="text-2xl font-black tracking-tight sm:text-3xl">Տուրերի օրացույց</h2>
      <Tabs value={tab} onValueChange={setTab} className="mt-4">
        <TabsList className="grid h-auto w-full grid-cols-2 rounded-full bg-muted p-1 sm:w-auto">
          <TabsTrigger value="upcoming" className="rounded-full px-4 py-2 text-sm font-bold">
            Առաջիկա տուրեր
          </TabsTrigger>
          <TabsTrigger value="directions" className="rounded-full px-4 py-2 text-sm font-bold">
            Մեր ուղղությունները
          </TabsTrigger>
        </TabsList>

        <TabsContent value="upcoming" className="mt-5">
          {loading ? (
            <p className="text-sm text-muted-foreground">Բեռնվում է...</p>
          ) : upcoming.length === 0 ? (
            <div className="rounded-3xl border border-border bg-card px-5 py-8 text-center">
              <p className="text-sm font-semibold">Այս պահին առաջիկա տուրեր չկան</p>
              <Button className="mt-4 rounded-full font-bold" onClick={() => setTab("directions")}>
                Դիտել մեր ուղղությունները
              </Button>
            </div>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {upcoming.map((row) => {
                const tour = toursById.get(row.tourId);
                if (!tour) return null;
                const title = tourTitle(tour, lang);
                const soldOut = row.availableSeats <= 0;
                return (
                  <article key={row.id} className="flex flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-card">
                    <TourCover src={tour.image_url} alt={title} position={tour.coverPosition} variant="card" />
                    <div className="flex flex-1 flex-col gap-3 p-4">
                      <h3 className="text-base font-bold leading-snug">{title}</h3>
                      <p className="text-sm text-muted-foreground">
                        {formatAssignedDepartureDate(row.departureDate)} · {tour.departureTime}
                      </p>
                      {soldOut ? (
                        <p className="text-sm font-bold text-destructive">Տեղերը սպառվել են</p>
                      ) : (
                        <p className="text-sm font-semibold">Մնացել է {row.availableSeats} տեղ</p>
                      )}
                      <Button
                        className="mt-auto rounded-full font-semibold"
                        disabled={soldOut}
                        onClick={() => navigate({ to: "/tours/$id", params: { id: tour.id }, hash: "book" })}
                      >
                        Ամրագրել
                      </Button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="directions" className="mt-5">
          {catalog.catalogStatus !== "loaded" ? (
            <p className="text-sm text-muted-foreground">Բեռնվում է...</p>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {published.map((tour) => {
                const title = tourTitle(tour, lang);
                return (
                  <article key={tour.id} className="flex flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-card">
                    <TourCover src={tour.image_url} alt={title} position={tour.coverPosition} variant="card" />
                    <div className="flex flex-1 flex-col gap-3 p-4">
                      <h3 className="text-base font-bold leading-snug">{title}</h3>
                      {upcoming !== null && !upcomingTourIds.has(tour.id) && (
                        <p className="text-sm text-muted-foreground">Առաջիկա մեկնում դեռ չկա</p>
                      )}
                      <Button
                        variant="outline"
                        className="mt-auto rounded-full font-semibold"
                        onClick={() => navigate({ to: "/tours/$id", params: { id: tour.id } })}
                      >
                        Մանրամասներ
                      </Button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </section>
  );
}
