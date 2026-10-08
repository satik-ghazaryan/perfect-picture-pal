import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { Check, Clock, MapPin, Star } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { TourPanorama } from "@/components/tour-panorama";
import { AudioGuidePlayer } from "@/components/audio-guide-player";
import { BookingPanel } from "@/components/express-booking";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { packingList, tourTypeLabels } from "@/data/tours";
import { pickLocale, tourDescription, tourLocation, tourTitle, useSiteLocale } from "@/lib/locale";
import { getAdminServerSnapshot, getAdminSnapshot, hydrateAdmin, resolveTour, subscribeAdmin } from "@/lib/admin";

export const Route = createFileRoute("/tours/$id")({
  validateSearch: (search: Record<string, unknown>): { ticket?: string } => {
    const ticket = search["ticket"];
    if (typeof ticket !== "string" || !ticket.startsWith("AG-")) return {};
    return { ticket: ticket.slice(0, 24) };
  },
  loader: ({ params }) => ({ id: params.id, tour: resolveTour(params.id) }),
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData?.tour ? `${tourTitle(loaderData.tour)} — Արի Գնանք` : "Տուր — Արի Գնանք",
      },
      {
        name: "description",
        content: loaderData?.tour ? tourDescription(loaderData.tour) || "Մեկօրյա տուրեր Արմավիրից։" : "Մեկօրյա տուրեր Արմավիրից։",
      },
    ],
  }),
  notFoundComponent: TourNotFound,
  component: TourDetailPage,
});

function TourNotFound() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <div className="mx-auto flex min-h-[70vh] max-w-lg flex-col items-center justify-center px-4 text-center">
        <p className="text-7xl font-black text-foreground">404</p>
        <h1 className="mt-4 text-xl font-bold">Տուրը չի գտնվել</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Այս հասցեով մեկօրյա տուր չկա։ Ընտրեք մեկը գլխավոր էջի ցանկից։
        </p>
        <Link
          to="/"
          className="mt-6 inline-flex h-10 items-center rounded-full bg-primary px-5 text-sm font-bold text-primary-foreground"
        >
          Գլխավոր էջ
        </Link>
      </div>
    </div>
  );
}

function TourDetailPage() {
  const { id, tour: loaded } = Route.useLoaderData();
  const catalog = useSyncExternalStore(subscribeAdmin, getAdminSnapshot, getAdminServerSnapshot);
  const [ready, setReady] = useState(false);
  const live = ready ? catalog.tours.find((item) => item.id === id) : undefined;
  const tour = live ?? loaded;
  const { ticket: shownTicket = "" } = Route.useSearch();
  const linkedId = tour?.is_virtual_only ? "" : tour?.virtual_tour_id?.trim() ?? "";
  const linkedTour = linkedId
    ? catalog.tours.find((item) => item.id === linkedId && item.is_virtual_only === true)
    : undefined;
  const showPanorama = linkedId.length > 0 && Boolean(linkedTour);
  const [tab, setTab] = useState(tour?.hasAudioGuide ? "audio" : "overview");
  const opened = useRef(false);
  const lang = useSiteLocale();
  const title = tour ? tourTitle(tour, lang) : "";
  const summary = tour ? tourDescription(tour, lang) : "";
  const regionLabel = tour ? tourLocation(tour, lang) : "";
  const typeLabel = tour ? pickLocale(tourTypeLabels[tour.type], lang) : "";

  useEffect(() => {
    hydrateAdmin();
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready || opened.current) return;
    if (linkedId && !linkedTour) return;
    opened.current = true;
    if (!tour) {
      document.title = "Տուրը չի գտնվել — Արի Գնանք";
      return;
    }
    document.title = `${tourTitle(tour, lang)} — Արի Գնանք`;
    if (window.location.hash === "#audio" && tour.hasAudioGuide) setTab("audio");
    else if (linkedTour) setTab("panorama");
  }, [ready, tour, linkedId, linkedTour, lang]);

  useEffect(() => {
    if (!ready || !tour) return;
    document.title = `${tourTitle(tour, lang)} — Արի Գնանք`;
  }, [ready, tour, lang]);

  if (!tour) {
    if (!ready) {
      return (
        <div className="min-h-screen bg-background">
          <SiteHeader />
          <p className="px-4 py-16 text-center text-sm text-muted-foreground">Բեռնվում է...</p>
        </div>
      );
    }
    return <TourNotFound />;
  }

  if (tour.is_virtual_only) {
    return <Navigate to="/virtual" hash={tour.id} replace />;
  }

  return (
    <div className="min-h-screen bg-background pb-[340px] lg:pb-16">
      <SiteHeader />

      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:py-10">
        <div className="min-w-0 space-y-8">
          <section className="overflow-hidden rounded-3xl border border-border bg-card shadow-card">
            <img
              src={tour.image_url}
              alt={title}
              width={1280}
              height={720}
              className="h-56 w-full object-cover sm:h-80"
            />
            <div className="space-y-4 p-5 sm:p-6">
              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                <span className="rounded-full bg-primary-soft px-2.5 py-1 text-primary">{regionLabel}</span>
                <span className="rounded-full bg-muted px-2.5 py-1">{typeLabel}</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2.5 py-1">
                  <Star className="h-3.5 w-3.5 fill-accent text-accent" />
                  {tour.rating}
                  <span className="font-medium text-muted-foreground">({tour.reviews})</span>
                </span>
              </div>
              <h1 className="text-2xl font-black tracking-tight sm:text-4xl">{title}</h1>
              {shownTicket && (
                <p className="w-fit rounded-full bg-primary-soft px-3 py-1 font-mono text-xs font-bold text-primary">
                  Թվային տոմս {shownTicket}
                </p>
              )}
              <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">{summary}</p>
            </div>
          </section>

          <section className="grid gap-3 rounded-3xl border border-border bg-card p-4 sm:grid-cols-3">
            <DetailFact icon={MapPin} label="Մեկնման վայր" value={tour.departurePlace} />
            <DetailFact icon={Clock} label="Մեկնում" value={tour.departureTime} />
            <DetailFact icon={Clock} label="Վերադարձ" value={tour.returnTime} />
          </section>

          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="h-auto w-full flex-wrap justify-start gap-1 rounded-2xl p-1">
              {showPanorama && (
                <TabsTrigger value="panorama" className="rounded-xl px-4 py-2">
                  360° դիտում
                </TabsTrigger>
              )}
              {tour.hasAudioGuide && (
                <TabsTrigger value="audio" className="rounded-xl px-4 py-2">
                  Աուդիոգիդ
                </TabsTrigger>
              )}
              <TabsTrigger value="overview" className="rounded-xl px-4 py-2">
                Կարևոր կետեր
              </TabsTrigger>
            </TabsList>
            {showPanorama && linkedTour && (
              <TabsContent value="panorama" className="mt-4">
                <TourPanorama tour={linkedTour} />
              </TabsContent>
            )}
            {tour.hasAudioGuide && (
              <TabsContent value="audio" className="mt-4">
                <AudioGuidePlayer chapters={tour.audioChapters} />
              </TabsContent>
            )}
            <TabsContent value="overview" className="mt-4">
              <ul className="grid gap-2 rounded-3xl border border-border bg-card p-4">
                {tour.highlights.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </TabsContent>
          </Tabs>

          <section>
            <h2 className="text-xl font-black">Օրվա ծրագիր</h2>
            <ol className="mt-4">
              {tour.itinerary.map((stop, index) => (
                <li key={`${stop.time}-${stop.title}`} className="grid grid-cols-[auto_minmax(0,1fr)] gap-4">
                  <div className="flex flex-col items-center">
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
                      {index + 1}
                    </span>
                    {index < tour.itinerary.length - 1 && <span className="w-px flex-1 bg-border" />}
                  </div>
                  <div className="pb-6">
                    <p className="text-xs font-bold text-primary">{stop.time}</p>
                    <p className="text-sm font-bold">{stop.title}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{stop.description}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className="grid gap-4 sm:grid-cols-2">
            <ItemList title="Ներառված է" items={tour.included} />
            <ItemList title="Ներառված չէ" items={tour.excluded} muted />
          </section>

          <PackingList />
        </div>

        <BookingPanel tour={tour} />
      </div>
    </div>
  );
}

function DetailFact({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof MapPin;
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-2xl bg-primary-soft text-primary">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold text-muted-foreground">{label}</p>
        <p className="text-sm font-bold leading-snug">{value}</p>
      </div>
    </div>
  );
}

function ItemList({ title, items, muted = false }: { title: string; items: string[]; muted?: boolean }) {
  return (
    <div className="rounded-3xl border border-border bg-card p-4">
      <h2 className="text-base font-black">{title}</h2>
      <ul className="mt-3 space-y-2">
        {items.map((item) => (
          <li key={item} className={cn("flex items-start gap-2 text-sm", muted && "text-muted-foreground")}>
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PackingList() {
  const [checked, setChecked] = useState<string[]>([]);

  return (
    <section>
      <h2 className="text-xl font-black">Ինչ վերցնել հետդ</h2>
      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {packingList.map((item) => {
          const on = checked.includes(item);
          return (
            <li key={item}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() =>
                  setChecked((current) =>
                    current.includes(item) ? current.filter((entry) => entry !== item) : [...current, item],
                  )
                }
                className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card px-3 py-2.5 text-left"
              >
                <span
                  className={cn(
                    "grid h-5 w-5 shrink-0 place-items-center rounded-md border",
                    on ? "border-primary bg-primary text-primary-foreground" : "border-input",
                  )}
                >
                  {on && <Check className="h-3.5 w-3.5" />}
                </span>
                <span className={cn("text-sm", on && "text-muted-foreground line-through")}>{item}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
