import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useSyncExternalStore } from "react";
import { SiteHeader } from "@/components/site-header";
import { TourPanorama } from "@/components/tour-panorama";
import { getAdminServerSnapshot, getAdminSnapshot, hydrateAdmin, subscribeAdmin } from "@/lib/admin";
import { tourDescription, tourLocation, tourTitle, useSiteLocale } from "@/lib/locale";

export const Route = createFileRoute("/virtual")({
  head: () => ({
    meta: [
      { title: "360° Վիրտուալ Տուրեր — Արի Գնանք" },
      {
        name: "description",
        content: "Առանձին 360° վայրեր՝ համայնապատկեր և տեղեկություն, առանց մեկնման և ամրագրման։",
      },
    ],
  }),
  component: VirtualToursPage,
});

function VirtualToursPage() {
  const catalog = useSyncExternalStore(subscribeAdmin, getAdminSnapshot, getAdminServerSnapshot);
  const lang = useSiteLocale();
  const [ready, setReady] = useState(false);
  const tours = catalog.tours.filter((tour) => tour.is_virtual_only === true);
  const tourIds = tours.map((tour) => tour.id).join("|");

  useEffect(() => {
    hydrateAdmin();
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready || tourIds.length === 0) return;
    const id = window.location.hash.replace("#", "");
    if (!id || !tourIds.split("|").includes(id)) return;
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [ready, tourIds]);

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <p className="text-xs font-bold uppercase tracking-wide text-primary">360°</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight">Վիրտուալ Տուրեր</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Դիտեք վայրերը համայնապատկերով և կարդացեք դրանց մասին։ Այստեղ մեկնում և ամրագրում չկա։
        </p>
        {!ready ? (
          <p className="mt-8 text-sm text-muted-foreground">Բեռնվում է...</p>
        ) : tours.length === 0 ? (
          <p className="mt-8 rounded-3xl border border-border bg-card px-4 py-6 text-sm text-muted-foreground">
            Վիրտուալ տուրեր դեռ չկան։
          </p>
        ) : (
          <div className="mt-8 space-y-10">
            {tours.map((tour) => {
              const title = tourTitle(tour, lang);
              const summary = tourDescription(tour, lang);
              return (
              <article key={tour.id} id={tour.id} className="scroll-mt-24 space-y-4">
                <div>
                  <p className="text-xs font-semibold text-primary">{tourLocation(tour, lang)}</p>
                  <h2 className="mt-1 text-2xl font-black tracking-tight">{title}</h2>
                </div>
                <TourPanorama tour={tour} />
                {summary.length > 0 && (
                  <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground sm:text-base">{summary}</p>
                )}
                {tour.highlights.length > 0 && (
                  <ul className="grid gap-2">
                    {tour.highlights.map((item) => (
                      <li key={item} className="text-sm leading-relaxed">{item}</li>
                    ))}
                  </ul>
                )}
              </article>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
