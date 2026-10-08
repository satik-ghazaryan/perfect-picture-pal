import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useSyncExternalStore } from "react";
import { format, parseISO } from "date-fns";
import { hy } from "date-fns/locale";
import { LogOut } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getAdminServerSnapshot,
  getAdminSnapshot,
  getTouristServerSnapshot,
  getTouristSnapshot,
  hydrateAdmin,
  refreshStoredDirectory,
  signInGuide,
  signOutTourist,
  subscribeAdmin,
  subscribeTourist,
} from "@/lib/admin";
import {
  getPortalServerSnapshot,
  getPortalSnapshot,
  loadTourManifest,
  openGuideSession,
  restoreGuideSession,
  setAttendance,
  signOutGuide,
  subscribePortal,
  type StaffProfile,
} from "@/lib/guide-api";
import type { AttendanceStatus } from "@/lib/database.types";
import { isSupabaseConfigured } from "@/lib/supabase";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/guide")({
  head: () => ({
    meta: [
      { title: "Զբոսավարի պորտալ — Արի Գնանք" },
      { name: "description", content: "Զբոսավարի նշանակված մեկնումները և ուղևորների ներկայությունը։" },
    ],
  }),
  component: GuidePage,
});

function GuidePage() {
  const navigate = useNavigate();
  const portal = useSyncExternalStore(subscribePortal, getPortalSnapshot, getPortalServerSnapshot);
  const currentUser = useSyncExternalStore(subscribeTourist, getTouristSnapshot, getTouristServerSnapshot);
  const users = useSyncExternalStore(subscribeAdmin, getAdminSnapshot, getAdminServerSnapshot).users;
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState("");

  useEffect(() => {
    let cancelled = false;
    hydrateAdmin();
    refreshStoredDirectory();
    const session = getTouristSnapshot();
    const directory = getAdminSnapshot().users.find((user) => user.id === session?.id);
    const role = directory?.role ?? session?.role;
    const finish = () => {
      if (!cancelled) setReady(true);
    };
    if (session && role === "guide") {
      openGuideSession({
        id: session.id,
        fullName: directory?.fullName ?? session.fullName,
        phone: directory?.phone ?? session.phone,
        email: directory?.email ?? session.email,
        role: "guide",
      });
      finish();
      return () => {
        cancelled = true;
      };
    }
    if (session) {
      finish();
      return () => {
        cancelled = true;
      };
    }
    restoreGuideSession()
      .catch((error: unknown) => {
        if (!cancelled) setBootError(error instanceof Error ? error.message : "Մուտքը չվերականգնվեց։");
      })
      .finally(finish);
    return () => {
      cancelled = true;
    };
  }, []);

  const directoryUser = currentUser ? users.find((user) => user.id === currentUser.id) : undefined;
  const accountRole = directoryUser?.role ?? currentUser?.role;
  const guideRole = accountRole === "guide";
  const profile = guideRole && portal.profile?.role === "guide" ? portal.profile : null;
  const denied = ready && currentUser !== null && !guideRole;

  useEffect(() => {
    if (!ready || !currentUser || guideRole) return;
    if (accountRole === "driver") void navigate({ to: "/driver" });
    else void navigate({ to: "/" });
  }, [ready, currentUser, guideRole, accountRole, navigate]);

  useEffect(() => {
    if (!ready || !currentUser || !guideRole) return;
    if (portal.profile?.id === currentUser.id && portal.profile.role === "guide") return;
    openGuideSession({
      id: currentUser.id,
      fullName: directoryUser?.fullName ?? currentUser.fullName,
      phone: directoryUser?.phone ?? currentUser.phone,
      email: directoryUser?.email ?? currentUser.email,
      role: "guide",
    });
  }, [ready, currentUser, guideRole, directoryUser, portal.profile]);

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
        {!ready && <p className="text-sm text-muted-foreground">Բեռնվում է...</p>}
        {ready && bootError && (
          <p className="mb-4 rounded-2xl bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">{bootError}</p>
        )}
        {denied && <p className="text-sm text-muted-foreground">Բեռնվում է...</p>}
        {ready && !denied && !profile && <GuideSignIn />}
        {ready && profile && <GuideHome profile={profile} users={users} />}
      </main>
    </div>
  );
}

function GuideSignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const submit = async () => {
    setPending(true);
    setError("");
    try {
      await signInGuide(email, password);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Մուտքը չհաջողվեց։");
    } finally {
      setPending(false);
    }
  };

  return (
    <form
      className="mx-auto max-w-md space-y-3 rounded-3xl border border-border bg-card p-5"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <h1 className="text-2xl font-black tracking-tight">Զբոսավարի մուտք</h1>
      <p className="text-sm text-muted-foreground">Մուտք գործեք զբոսավարի հաշվով՝ տեսնելու միայն ձեզ նշանակված մեկնումները։</p>
      {!isSupabaseConfigured && (
        <p className="rounded-2xl bg-primary-soft px-3 py-2 text-xs">Տեղային զբոսավար՝ guide@arignank.am / guide1234</p>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="guide-email">Էլ. փոստ</Label>
        <Input id="guide-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" className="h-11 rounded-2xl" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="guide-password">Գաղտնաբառ</Label>
        <Input id="guide-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" className="h-11 rounded-2xl" />
      </div>
      {error && <p className="text-xs font-medium text-destructive">{error}</p>}
      <Button type="submit" className="h-11 w-full rounded-full font-bold" disabled={pending}>
        {pending ? "Մտնում է" : "Մուտք"}
      </Button>
    </form>
  );
}

function GuideHome({
  profile,
  users,
}: {
  profile: StaffProfile;
  users: { id: string; fullName: string; phone: string; avatarUrl: string; bio: string; role: string }[];
}) {
  const portal = useSyncExternalStore(subscribePortal, getPortalSnapshot, getPortalServerSnapshot);
  const tours = portal.tours.filter((tour) => tour.guideId === profile.id);
  const tourKey = tours.map((tour) => tour.id).join("|");
  const [openId, setOpenId] = useState("");
  const openTour = tours.find((tour) => tour.id === openId) ?? null;

  useEffect(() => {
    const ids = tourKey ? tourKey.split("|") : [];
    const next = ids.includes(openId) ? openId : ids[0] ?? "";
    if (next !== openId) setOpenId(next);
  }, [tourKey, openId]);

  useEffect(() => {
    if (!openTour) return;
    let cancelled = false;
    void loadTourManifest(openTour.id, openTour.departureDate).catch(() => {
      if (cancelled) return;
    });
    return () => {
      cancelled = true;
    };
  }, [openTour]);

  const mark = async (bookingId: string, next: AttendanceStatus | null) => {
    try {
      await setAttendance(bookingId, next);
    } catch {
      /* The local copy is already updated when the remote write fails. */
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-primary">Զբոսավար</p>
          <h1 className="mt-1 text-2xl font-black tracking-tight">{profile.fullName}</h1>
        </div>
        <Button
          type="button"
          variant="outline"
          className="rounded-full"
          onClick={() => {
            signOutTourist();
            void signOutGuide();
          }}
        >
          <LogOut className="h-4 w-4" />
          Ելք
        </Button>
      </div>
      {tours.length === 0 ? (
        <p className="rounded-3xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          Ձեզ տուր դեռ նշանակված չէ։
        </p>
      ) : (
        tours.map((tour) => {
          const driver = users.find((user) => user.id === tour.driverId && user.role === "driver") ?? null;
          const open = tour.id === openId;
          const passengers = portal.bookings
            .filter((booking) => booking.tourId === tour.id)
            .slice()
            .sort((a, b) => a.seatNumber - b.seatNumber);
          return (
            <article key={tour.id} className="space-y-4 rounded-3xl border border-border bg-card p-4 sm:p-5">
              <button type="button" className="w-full text-left" aria-expanded={open} onClick={() => setOpenId(tour.id)}>
                <h2 className="text-lg font-black leading-snug">{tour.title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {format(parseISO(tour.departureDate), "d MMMM yyyy", { locale: hy })} · մեկնում {tour.departureTime}
                </p>
                <p className="mt-1 text-sm font-semibold">Ամրագրված ուղևորներ՝ {passengers.length}</p>
              </button>
              <div className="rounded-2xl bg-muted px-3 py-3">
                <p className="text-xs font-semibold text-muted-foreground">Վարորդ</p>
                {driver ? (
                  <div className="mt-2 flex gap-3">
                    {driver.avatarUrl ? (
                      <img src={driver.avatarUrl} alt="" className="h-12 w-12 rounded-full object-cover" />
                    ) : null}
                    <div>
                      <p className="text-sm font-bold">{driver.fullName}</p>
                      <p className="text-xs">{driver.phone || "Հեռախոսը նշված չէ"}</p>
                      {driver.bio && <p className="mt-1 text-xs text-muted-foreground">{driver.bio}</p>}
                    </div>
                  </div>
                ) : (
                  <p className="mt-1 text-sm">Վարորդ դեռ նշանակված չէ։</p>
                )}
              </div>
              {open && (
              <div>
                <h3 className="text-sm font-bold">Ուղևորացուցակ</h3>
                {passengers.length === 0 ? (
                  <p className="mt-2 rounded-2xl bg-muted px-3 py-3 text-sm text-muted-foreground">
                    Այս տուրի համար դեռևս գրանցված զբոսաշրջիկներ չկան
                  </p>
                ) : (
                  <ul className="mt-2 divide-y divide-border">
                    {passengers.map((booking) => (
                      <li key={booking.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                        <div className="min-w-0">
                          <p className="text-sm font-bold">{booking.passengerName}</p>
                          <p className="text-xs text-muted-foreground">Հեռախոսահամար՝ {booking.phone || "—"}</p>
                          <p className="text-xs text-muted-foreground">Տեղերի քանակ՝ {booking.adults + booking.children}</p>
                        </div>
                        <div className="flex gap-2">
                          {(
                            [
                              ["present", "Ներկա"],
                              ["absent", "Բացակա"],
                            ] as const
                          ).map(([value, label]) => (
                            <button
                              key={value}
                              type="button"
                              aria-pressed={booking.attendance === value}
                              onClick={() => void mark(booking.id, booking.attendance === value ? null : value)}
                              className={cn(
                                "rounded-full border px-3 py-1.5 text-xs font-bold",
                                booking.attendance === value
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "border-border bg-background",
                              )}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              )}
            </article>
          );
        })
      )}
    </div>
  );
}
