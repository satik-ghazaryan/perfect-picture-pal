import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useSyncExternalStore } from "react";
import { format, parseISO } from "date-fns";
import { hy } from "date-fns/locale";
import { toast } from "sonner";
import { SiteHeader } from "@/components/site-header";
import { DepartureCrew } from "@/components/departure-crew";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatAmd } from "@/data/tours";
import { tourTitle, useSiteLocale } from "@/lib/locale";
import {
  getAdminServerSnapshot,
  getAdminSnapshot,
  getTouristServerSnapshot,
  getTouristSnapshot,
  hydrateAdmin,
  subscribeAdmin,
  subscribeTourist,
} from "@/lib/admin";
import {
  getLoyaltyServerSnapshot,
  getLoyaltySnapshot,
  hydrateLoyalty,
  issuePromoCredit,
  loadLoyalty,
  phoneKey,
  subscribeLoyalty,
  type PromoCredit,
} from "@/lib/loyalty";
import {
  getPortalServerSnapshot,
  getPortalSnapshot,
  subscribePortal,
  upcomingDepartureDate,
  type BookingRecord,
} from "@/lib/guide-api";

export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [
      { title: "Իմ էջը — Արի Գնանք" },
      { name: "description", content: "Զբոսաշրջիկի անձնական էջ՝ միավորներ, ամրագրումներ և նախորդ տուրեր։" },
    ],
  }),
  component: ProfilePage,
});

function formatBirth(value: string) {
  if (!value) return "—";
  const parsed = parseISO(value.length > 10 ? value : `${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return "—";
  return format(parsed, "d MMMM yyyy", { locale: hy });
}

function formatDeparture(date: string) {
  if (!date) return "—";
  const parsed = parseISO(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return format(parsed, "d MMMM yyyy", { locale: hy });
}

function bookingStatusText(booking: BookingRecord) {
  if (booking.paymentStatus === "FAILED") return "Չհաջողված";
  if (booking.paymentStatus === "PENDING") return "Սպասում";
  if (booking.status === "checked_in") return "Գրանցված";
  if (booking.paymentStatus === "SUCCESS") return "Վճարված";
  return "Հաստատված";
}

function initial(name: string) {
  const letter = name.trim().charAt(0);
  return letter || "•";
}

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function isCompleted(date: string) {
  const at = new Date(`${date}T00:00:00`);
  if (Number.isNaN(at.getTime())) return false;
  return at.getTime() < startOfToday();
}

function ProfilePage() {
  const navigate = useNavigate();
  const session = useSyncExternalStore(subscribeTourist, getTouristSnapshot, getTouristServerSnapshot);
  const catalog = useSyncExternalStore(subscribeAdmin, getAdminSnapshot, getAdminServerSnapshot);
  const portal = useSyncExternalStore(subscribePortal, getPortalSnapshot, getPortalServerSnapshot);
  const wallet = useSyncExternalStore(subscribeLoyalty, getLoyaltySnapshot, getLoyaltyServerSnapshot);
  const lang = useSiteLocale();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    hydrateAdmin();
    hydrateLoyalty();
    setReady(true);
  }, []);

  const person = session ? catalog.users.find((user) => user.id === session.id) : undefined;
  const phone = person?.phone || session?.phone || "";

  useEffect(() => {
    if (!ready || session?.role !== "tourist" || phoneKey(phone).length < 8) return;
    void loadLoyalty(phone).catch(() => undefined);
  }, [ready, session?.role, phone]);

  useEffect(() => {
    if (!ready) return;
    if (!session) {
      void navigate({ to: "/login", search: { redirect: "/profile" } });
      return;
    }
    if (session.role === "guide") void navigate({ to: "/guide" });
    if (session.role === "driver") void navigate({ to: "/driver" });
  }, [ready, session, navigate]);

  if (!ready || !session || session.role !== "tourist") {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
          <p className="text-sm text-muted-foreground">Բեռնվում է...</p>
        </main>
      </div>
    );
  }

  const fullName = person?.fullName || session.fullName;
  const email = person?.email || session.email;
  const birthDate = person?.birthDate ?? "";
  const account = wallet.accounts[phoneKey(phone)];
  const points = account?.points ?? 0;
  const credits = account?.credits ?? [];
  const digits = phoneKey(phone);
  const trips = portal.bookings.flatMap((booking) => {
    if (phoneKey(booking.phone) !== digits) return [];
    const tour = catalog.tours.find((item) => item.id === booking.tourId && item.is_virtual_only !== true);
    const assigned = portal.tours.find((item) => item.id === booking.tourId);
    if (!tour && !assigned) return [];
    const departureDate = assigned?.departureDate || (tour ? upcomingDepartureDate(tour.day) : "");
    return [
      {
        id: booking.id,
        tourId: booking.tourId,
        title: tour ? tourTitle(tour, lang) : assigned?.title || "Տուր",
        departureDate,
        departureTime: tour?.departureTime || assigned?.departureTime || "",
        seats: booking.adults + booking.children,
        status: bookingStatusText(booking),
        guideId: tour?.guideId ?? assigned?.guideId ?? null,
        driverId: tour?.driverId ?? assigned?.driverId ?? null,
        image: tour?.image_url ?? "",
        completed: isCompleted(departureDate),
      },
    ];
  });
  const upcoming = trips.filter((trip) => !trip.completed);
  const past = trips.filter((trip) => trip.completed);
  const pastByTour = new Map<string, (typeof past)[number]>();
  for (const trip of past) {
    if (!pastByTour.has(trip.tourId)) pastByTour.set(trip.tourId, trip);
  }
  const photos = [...pastByTour.values()].flatMap((trip) => {
    const cover = trip.image ? [{ id: `cover-${trip.tourId}`, url: trip.image, title: trip.title }] : [];
    const uploaded = portal.photos
      .filter((photo) => photo.tourId === trip.tourId)
      .map((photo) => ({ id: photo.id, url: photo.url, title: trip.title }));
    return [...cover, ...uploaded];
  });

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
        <section className="rounded-3xl border border-border bg-card p-5">
          <div className="flex items-center gap-4">
            <Avatar className="h-16 w-16">
              <AvatarFallback className="bg-primary-soft text-lg font-black text-primary">{initial(fullName)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-wide text-primary">Իմ էջը</p>
              <h1 className="truncate text-2xl font-black tracking-tight">{fullName}</h1>
            </div>
          </div>
          <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">Հեռախոս</dt>
              <dd className="font-semibold">{phone || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Էլ. փոստ</dt>
              <dd className="truncate font-semibold">{email || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Ծննդյան ամսաթիվ</dt>
              <dd className="font-semibold">{formatBirth(birthDate)}</dd>
            </div>
          </dl>
        </section>

        <section className="flex flex-col gap-4 rounded-3xl bg-primary-soft p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold text-muted-foreground">Կուտակված միավորներ</p>
            <p className="mt-2 text-4xl font-black tracking-tight text-primary">⭐ {points} Միավոր</p>
          </div>
          <RedeemPoints phone={phone} fullName={fullName} points={points} credits={credits} />
        </section>

        <Tabs defaultValue="current">
          <TabsList className="grid h-auto w-full grid-cols-1 gap-1 rounded-2xl p-1 sm:grid-cols-3">
            <TabsTrigger value="current" className="rounded-xl">Ընթացիկ Ամրագրումներ</TabsTrigger>
            <TabsTrigger value="past" className="rounded-xl">Նախորդ Տուրեր</TabsTrigger>
            <TabsTrigger value="photos" className="rounded-xl">Տուրերի Լուսանկարներ</TabsTrigger>
          </TabsList>

          <TabsContent value="current" className="mt-4 space-y-4">
            {upcoming.length === 0 ? (
              <p className="rounded-3xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
                Ընթացիկ ամրագրում չկա։
              </p>
            ) : (
              upcoming.map((trip) => (
                <article key={trip.id} className="space-y-3">
                  <div className="rounded-3xl border border-border bg-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <h2 className="text-base font-black leading-snug">{trip.title}</h2>
                      <span className="shrink-0 rounded-full bg-primary-soft px-2.5 py-1 text-xs font-bold text-primary">
                        {trip.status}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {formatDeparture(trip.departureDate)}
                      {trip.departureTime ? ` · մեկնում ${trip.departureTime}` : ""}
                    </p>
                    <p className="mt-1 text-sm font-semibold">Տեղերի քանակ՝ {trip.seats}</p>
                  </div>
                  <DepartureCrew
                    departureDate={trip.departureDate}
                    departureTime={trip.departureTime}
                    guideId={trip.guideId}
                    driverId={trip.driverId}
                  />
                </article>
              ))
            )}
            <Button className="rounded-full font-bold" asChild>
              <Link to="/">Ընտրել տուր</Link>
            </Button>
          </TabsContent>

          <TabsContent value="past" className="mt-4 space-y-3">
            {past.length === 0 ? (
              <p className="rounded-3xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
                Նախորդ տուրեր դեռ չկան։
              </p>
            ) : (
              past.map((trip) => (
                <article key={trip.id} className="rounded-3xl border border-border bg-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="text-base font-black leading-snug">{trip.title}</h2>
                    <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-bold">{trip.status}</span>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {formatDeparture(trip.departureDate)}
                    {trip.departureTime ? ` · մեկնում ${trip.departureTime}` : ""}
                  </p>
                  <p className="mt-1 text-sm font-semibold">Տեղերի քանակ՝ {trip.seats}</p>
                </article>
              ))
            )}
          </TabsContent>

          <TabsContent value="photos" className="mt-4">
            {photos.length === 0 ? (
              <p className="rounded-3xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
                Ավարտված տուրերի լուսանկարներ դեռ չկան։
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {photos.map((photo) => (
                  <figure key={photo.id} className="overflow-hidden rounded-2xl border border-border bg-card">
                    <img src={photo.url} alt={photo.title} className="aspect-square w-full object-cover" />
                    <figcaption className="px-2 py-2 text-xs font-semibold leading-snug">{photo.title}</figcaption>
                  </figure>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function RedeemPoints({
  phone,
  fullName,
  points,
  credits,
}: {
  phone: string;
  fullName: string;
  points: number;
  credits: PromoCredit[];
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const creditTotal = credits.reduce((sum, credit) => sum + credit.amount, 0);

  const submit = async () => {
    setSaving(true);
    setError("");
    try {
      const result = await issuePromoCredit({ phone, fullName, points: Number(amount) });
      toast.success(`Զեղչի կտրոն ${result.credit.code}՝ ${formatAmd(result.credit.amount)}`);
      setAmount("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Միավորները չփոխարինվեցին։");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button type="button" className="rounded-full font-bold" onClick={() => setOpen(true)}>
        Օգտագործել միավորները
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setError("");
        }}
      >
        <DialogContent className="rounded-3xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Փոխարինել զեղչի</DialogTitle>
            <DialogDescription>1 միավոր = 1 ֏։ Կտրոնը կիրառվում է հաջորդ ամրագրման ժամանակ։</DialogDescription>
          </DialogHeader>
          <p className="text-sm font-semibold">Հասանելի է՝ {points} միավոր</p>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="redeem-points">Միավորներ</Label>
              <Input
                id="redeem-points"
                inputMode="numeric"
                value={amount}
                onChange={(event) => setAmount(event.target.value.replace(/\D/g, ""))}
                placeholder={points > 0 ? String(points) : "0"}
                className="h-11 rounded-2xl"
              />
            </div>
            {error && <p className="text-xs font-medium text-destructive">{error}</p>}
            <Button type="submit" className="w-full rounded-full font-bold" disabled={saving || points < 1}>
              {saving ? "Պահվում է" : "Փոխարինել զեղչի"}
            </Button>
          </form>
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground">Ակտիվ զեղչեր՝ {formatAmd(creditTotal)}</p>
            {credits.length === 0 ? (
              <p className="text-sm text-muted-foreground">Ակտիվ կտրոն դեռ չկա։</p>
            ) : (
              <ul className="space-y-2">
                {credits.map((credit) => (
                  <li key={credit.id} className="flex items-center justify-between rounded-2xl bg-muted px-3 py-2 text-sm">
                    <span className="font-bold">{credit.code}</span>
                    <span>{formatAmd(credit.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
