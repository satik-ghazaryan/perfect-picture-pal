import { useEffect, useState } from "react";
import { useSyncExternalStore } from "react";
import { format, parseISO } from "date-fns";
import { hy } from "date-fns/locale";
import { Camera, LogOut, MapPin, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QrScanner } from "@/components/qr-scanner";
import {
  checkInPassenger,
  getPortalServerSnapshot,
  getPortalSnapshot,
  listBookings,
  listPhotos,
  signOutGuide,
  subscribePortal,
  updateTourStatus,
  uploadTourPhotos,
  type StaffProfile,
  type TourStatus,
} from "@/lib/guide-api";
import { isSupabaseConfigured } from "@/lib/supabase";
import { cn } from "@/lib/utils";

const tourStatusLabel: Record<TourStatus, string> = {
  scheduled: "Նախատեսված",
  in_progress: "Ընթացքի մեջ",
  completed: "Ավարտված",
};

export function GuideDashboard({ profile }: { profile: StaffProfile }) {
  const portal = useSyncExternalStore(subscribePortal, getPortalSnapshot, getPortalServerSnapshot);
  const tours = portal.tours.filter(
    (tour) => tour.guideId === profile.id || tour.driverId === profile.id,
  );
  const [selectedId, setSelectedId] = useState(tours[0]?.id ?? "");
  const [remoteBookings, setRemoteBookings] = useState(portal.bookings);
  const [remotePhotos, setRemotePhotos] = useState(portal.photos);
  const [notice, setNotice] = useState("");
  const [noticeOk, setNoticeOk] = useState(true);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!selectedId && tours[0]) setSelectedId(tours[0].id);
  }, [selectedId, tours]);

  useEffect(() => {
    if (!selectedId || !isSupabaseConfigured) return;
    let cancelled = false;
    setPending(true);
    Promise.all([listBookings(selectedId), listPhotos(selectedId)])
      .then(([bookings, photos]) => {
        if (cancelled) return;
        setRemoteBookings(bookings);
        setRemotePhotos(photos);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setNoticeOk(false);
          setNotice(error instanceof Error ? error.message : "Տվյալները չբեռնվեցին։");
        }
      })
      .finally(() => {
        if (!cancelled) setPending(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const selected = tours.find((tour) => tour.id === selectedId) ?? null;
  const bookings = (
    isSupabaseConfigured ? remoteBookings : portal.bookings.filter((item) => item.tourId === selectedId)
  ).slice().sort((a, b) => a.seatNumber - b.seatNumber);
  const photos = isSupabaseConfigured
    ? remotePhotos
    : portal.photos.filter((item) => item.tourId === selectedId);
  const checkedIn = bookings.filter((item) => item.status === "checked_in").length;

  const scan = async (code: string) => {
    if (!selected) return;
    const result = await checkInPassenger(selected.id, code);
    setNotice(result.message);
    setNoticeOk(result.ok);
    if (isSupabaseConfigured) setRemoteBookings(await listBookings(selected.id));
  };

  const changeStatus = async (status: TourStatus) => {
    if (!selected) return;
    setPending(true);
    try {
      await updateTourStatus(selected.id, status);
      setNoticeOk(true);
      setNotice(status === "in_progress" ? "Տուրը սկսված է։" : "Տուրը ավարտված է։");
    } catch (error) {
      setNoticeOk(false);
      setNotice(error instanceof Error ? error.message : "Կարգավիճակը չփոխվեց։");
    } finally {
      setPending(false);
    }
  };

  const upload = async (list: FileList | null) => {
    if (!selected || !list?.length) return;
    setPending(true);
    try {
      const saved = await uploadTourPhotos(selected.id, [...list], profile.id);
      if (isSupabaseConfigured) setRemotePhotos((current) => [...current, ...saved]);
      setNoticeOk(true);
      setNotice("Լուսանկարները ավելացվեցին ալբոմում։");
    } catch (error) {
      setNoticeOk(false);
      setNotice(error instanceof Error ? error.message : "Վերբեռնումը չհաջողվեց։");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
      <section className="min-h-64 rounded-3xl border border-border bg-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-muted-foreground">
              {profile.role === "driver" ? "Վարորդ" : "Ուղեկցորդ"}
            </p>
            <h1 className="text-lg font-black">{profile.fullName}</h1>
          </div>
          <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={() => void signOutGuide()}>
            <LogOut className="h-4 w-4" />
            Ելք
          </Button>
        </div>
        <p className="mt-4 text-sm font-bold">Իմ տուրերը</p>
        <div className="mt-3 space-y-2">
          {tours.length === 0 && (
            <p className="rounded-2xl bg-muted px-3 py-4 text-sm text-muted-foreground">
              Ձեզ տուր դեռ չի նշանակվել։
            </p>
          )}
          {tours.map((tour) => (
            <button
              key={tour.id}
              type="button"
              onClick={() => {
                setSelectedId(tour.id);
                setNotice("");
              }}
              className={cn(
                "w-full rounded-2xl border px-3 py-3 text-left",
                tour.id === selectedId ? "border-primary bg-primary-soft" : "border-border",
              )}
            >
              <span className="block text-sm font-bold leading-snug">{tour.title}</span>
              <span className="mt-1 block text-xs text-muted-foreground">
                {format(parseISO(tour.departureDate), "d MMMM", { locale: hy })} · {tour.departureTime}
              </span>
              <span className="mt-2 inline-flex rounded-full bg-card px-2 py-0.5 text-[11px] font-bold">
                {tourStatusLabel[tour.status]}
              </span>
            </button>
          ))}
        </div>
      </section>

      <div className="min-w-0 space-y-4">
        {selected && (
          <section className="rounded-3xl border border-border bg-card p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-black">{selected.title}</h2>
                <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5" />
                  {selected.departurePlace}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  className="rounded-full"
                  disabled={pending || selected.status !== "scheduled"}
                  onClick={() => void changeStatus("in_progress")}
                >
                  Սկսել
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-full"
                  disabled={pending || selected.status !== "in_progress"}
                  onClick={() => void changeStatus("completed")}
                >
                  Ավարտել
                </Button>
              </div>
            </div>
          </section>
        )}

        <section className="min-h-72 rounded-3xl border border-border bg-card p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-base font-black">
              <Users className="h-4 w-4 text-primary" />
              Ուղևորացուցակ
            </h2>
            <p className="text-xs font-semibold text-muted-foreground">
              {checkedIn}/{bookings.length} գրանցված
            </p>
          </div>
          {bookings.length === 0 ? (
            <p className="mt-4 rounded-2xl bg-muted px-3 py-6 text-sm text-muted-foreground">
              Այս տուրի համար ամրագրումներ չկան։
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-border">
              {bookings.map((booking) => (
                <li key={booking.id} className="flex flex-wrap items-center gap-3 py-3">
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-primary-soft text-sm font-black text-primary">
                    {booking.seatNumber}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold">{booking.passengerName}</p>
                    <p className="text-xs text-muted-foreground">
                      {booking.phone} · {booking.adults} մեծահասակ · {booking.children} երեխա
                    </p>
                    <p className="font-mono text-[11px] text-muted-foreground">{booking.ticketCode}</p>
                  </div>
                  {booking.status === "checked_in" ? (
                    <span className="rounded-full bg-primary px-2.5 py-1 text-[11px] font-bold text-primary-foreground">
                      Գրանցված է
                    </span>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="rounded-full"
                      onClick={() => void scan(booking.ticketCode)}
                    >
                      Գրանցել
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-3xl border border-border bg-card p-4 sm:p-5">
          <h2 className="text-base font-black">QR գրանցում</h2>
          <div className="mt-4">
            <QrScanner onScan={scan} disabled={!selected || pending} />
          </div>
          <p
            className={cn(
              "mt-3 min-h-5 text-sm font-semibold",
              !notice && "invisible",
              noticeOk ? "text-primary" : "text-destructive",
            )}
            aria-live="polite"
          >
            {notice || "\u00a0"}
          </p>
        </section>

        <section className="rounded-3xl border border-border bg-card p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-base font-black">
              <Camera className="h-4 w-4 text-primary" />
              Տուրից հետո ալբոմ
            </h2>
            <label className="inline-flex h-9 cursor-pointer items-center rounded-full bg-primary px-4 text-sm font-bold text-primary-foreground">
              Ավելացնել լուսանկար
              <input
                type="file"
                accept="image/*"
                multiple
                className="sr-only"
                disabled={!selected || pending}
                onChange={(event) => {
                  void upload(event.target.files);
                  event.target.value = "";
                }}
              />
            </label>
          </div>
          {photos.length === 0 ? (
            <p className="mt-4 min-h-24 rounded-2xl bg-muted px-3 py-6 text-sm text-muted-foreground">
              Ալբոմը դեռ դատարկ է։
            </p>
          ) : (
            <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {photos.map((photo) => (
                <li key={photo.id} className="overflow-hidden rounded-2xl border border-border">
                  <img src={photo.url} alt="" className="aspect-square w-full object-cover" />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
