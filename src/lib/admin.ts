import { getTourById, regions, tours, type AudioChapter, type Hotspot, type ItineraryStop, type Tour } from "@/data/tours";
import type { PaymentProviderName, PaymentState } from "@/lib/database.types";
import {
  assignPortalStaff,
  getPortalSnapshot,
  LOCAL_DRIVER_ID,
  LOCAL_STAFF_ID,
  removePortalTour,
  upcomingDepartureDate,
  upsertPortalTour,
  type BookingRecord,
} from "@/lib/guide-api";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

export type ManagedTour = Tour & {
  panoramaUrl: string;
  guideId: string | null;
  driverId: string | null;
};

export type SiteSettings = {
  bannerTitle: string;
  bannerText: string;
  departurePlace: string;
  cashbackPercent: number;
};

export type AdminSession = {
  id: string;
  fullName: string;
  email: string;
  role: "admin";
};

export type StaffMember = {
  id: string;
  fullName: string;
  role: "guide" | "driver";
};

type AdminState = {
  tours: ManagedTour[];
  settings: SiteSettings;
  session: AdminSession | null;
};

export const localStaff: StaffMember[] = [
  { id: LOCAL_STAFF_ID, fullName: "Արմավիրի ուղեկցորդ", role: "guide" },
  { id: "local-guide-ani", fullName: "Անի Գրիգորյան", role: "guide" },
  { id: "local-guide-hayk", fullName: "Հայկ Սարգսյան", role: "guide" },
  { id: LOCAL_DRIVER_ID, fullName: "Արմեն Ավետիսյան", role: "driver" },
  { id: "local-driver-narek", fullName: "Նարեկ Հովհաննիսյան", role: "driver" },
];

const CATALOG_KEY = "ari-gnank-catalog";
const SESSION_KEY = "ari-gnank-admin-session";

export const defaultSettings: SiteSettings = {
  bannerTitle: "Բացահայտիր Հայաստանը\nմեկ օրում",
  bannerText:
    "Հնագույն վանքեր, լեռնային լճեր ու անմոռանալի տեսարաններ՝ փոքր խմբերով ճանապարհորդություններ, որոնք սկսվում են Արմավիրից։",
  departurePlace: "Արմավիր քաղաք, Կենտրոնական հրապարակ",
  cashbackPercent: 5,
};

const fallbackImage = tours[0]?.image ?? "";

function seedManaged(): ManagedTour[] {
  return tours.map((tour) => ({
    ...tour,
    panoramaUrl: tour.panoramaUrl ?? "",
    guideId: LOCAL_STAFF_ID,
    driverId: LOCAL_DRIVER_ID,
  }));
}

const serverSnapshot: AdminState = {
  tours: seedManaged(),
  settings: defaultSettings,
  session: null,
};

let state: AdminState = serverSnapshot;
let hydrated = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function persist() {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(
    CATALOG_KEY,
    JSON.stringify({ tours: state.tours, settings: state.settings }),
  );
  if (typeof sessionStorage === "undefined") return;
  if (!state.session) sessionStorage.removeItem(SESSION_KEY);
  else sessionStorage.setItem(SESSION_KEY, JSON.stringify(state.session));
}

function setState(patch: Partial<AdminState>) {
  state = { ...state, ...patch };
  persist();
  emit();
}

export function subscribeAdmin(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getAdminSnapshot() {
  return state;
}

export function getAdminServerSnapshot() {
  return serverSnapshot;
}

export function getCashbackRate() {
  return Math.min(1, Math.max(0, state.settings.cashbackPercent / 100));
}

function isStop(value: unknown): value is ItineraryStop {
  if (!value || typeof value !== "object") return false;
  const stop = value as ItineraryStop;
  return typeof stop.time === "string" && typeof stop.title === "string" && typeof stop.description === "string";
}

function readChapter(value: unknown): AudioChapter | null {
  if (!value || typeof value !== "object") return null;
  const chapter = value as Partial<AudioChapter>;
  if (typeof chapter.id !== "string" || typeof chapter.title !== "string" || typeof chapter.duration !== "number") {
    return null;
  }
  const next: AudioChapter = {
    id: chapter.id,
    title: chapter.title,
    duration: chapter.duration,
  };
  if (typeof chapter.audioUrl === "string" && chapter.audioUrl.trim()) next.audioUrl = chapter.audioUrl.trim();
  if (chapter.language === "hy" || chapter.language === "en" || chapter.language === "ru") {
    next.language = chapter.language;
  }
  return next;
}

function isHotspot(value: unknown): value is Hotspot {
  if (!value || typeof value !== "object") return false;
  const hotspot = value as Hotspot;
  return (
    typeof hotspot.id === "string" &&
    typeof hotspot.title === "string" &&
    typeof hotspot.description === "string" &&
    typeof hotspot.x === "number" &&
    typeof hotspot.y === "number"
  );
}

function stringsOf(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback;
  const items = value.filter((item): item is string => typeof item === "string");
  return items;
}

function sanitizeTour(value: unknown): ManagedTour | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<ManagedTour>;
  if (typeof raw.id !== "string" || typeof raw.title !== "string" || !raw.title.trim()) return null;
  const base = getTourById(raw.id);
  const image = typeof raw.image === "string" && raw.image ? raw.image : base?.image ?? fallbackImage;
  if (!image) return null;
  const type = raw.type === "Արշավային" || raw.type === "Մշակութային" || raw.type === "Էքստրեմալ"
    ? raw.type
    : base?.type ?? "Մշակութային";
  const tour: ManagedTour = {
    id: raw.id,
    title: raw.title,
    image,
    region: typeof raw.region === "string" && raw.region ? raw.region : base?.region ?? regions[0] ?? "Արմավիր",
    type,
    departurePlace: typeof raw.departurePlace === "string" && raw.departurePlace
      ? raw.departurePlace
      : base?.departurePlace ?? defaultSettings.departurePlace,
    departureTime: typeof raw.departureTime === "string" && raw.departureTime ? raw.departureTime : base?.departureTime ?? "08:30",
    returnTime: typeof raw.returnTime === "string" && raw.returnTime ? raw.returnTime : base?.returnTime ?? "19:00",
    price: typeof raw.price === "number" ? raw.price : base?.price ?? 0,
    seatsLeft: typeof raw.seatsLeft === "number" ? raw.seatsLeft : base?.seatsLeft ?? 0,
    rating: typeof raw.rating === "number" ? raw.rating : base?.rating ?? 5,
    reviews: typeof raw.reviews === "number" ? raw.reviews : base?.reviews ?? 0,
    has360: typeof raw.has360 === "boolean" ? raw.has360 : base?.has360 ?? false,
    hasAudioGuide: typeof raw.hasAudioGuide === "boolean" ? raw.hasAudioGuide : base?.hasAudioGuide ?? false,
    day: raw.day === "sunday" ? "sunday" : base?.day ?? "saturday",
    summary: typeof raw.summary === "string" ? raw.summary : base?.summary ?? "",
    highlights: stringsOf(raw.highlights, base?.highlights ?? []),
    itinerary: Array.isArray(raw.itinerary) ? raw.itinerary.filter(isStop) : base?.itinerary ?? [],
    included: stringsOf(raw.included, base?.included ?? []),
    excluded: stringsOf(raw.excluded, base?.excluded ?? []),
    audioChapters: Array.isArray(raw.audioChapters)
      ? raw.audioChapters.flatMap((item) => {
          const chapter = readChapter(item);
          return chapter ? [chapter] : [];
        })
      : base?.audioChapters ?? [],
    hotspots: Array.isArray(raw.hotspots) ? raw.hotspots.filter(isHotspot) : base?.hotspots ?? [],
    panoramaUrl: typeof raw.panoramaUrl === "string" ? raw.panoramaUrl : "",
    guideId: typeof raw.guideId === "string" || raw.guideId === null ? raw.guideId : base ? LOCAL_STAFF_ID : null,
    driverId: typeof raw.driverId === "string" || raw.driverId === null ? raw.driverId : base ? LOCAL_DRIVER_ID : null,
  };
  if (typeof raw.oldPrice === "number") tour.oldPrice = raw.oldPrice;
  else if (base?.oldPrice !== undefined) tour.oldPrice = base.oldPrice;
  return tour;
}

function readSettings(value: unknown): SiteSettings | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<SiteSettings>;
  if (typeof raw.bannerTitle !== "string" || typeof raw.bannerText !== "string") return null;
  if (typeof raw.departurePlace !== "string" || typeof raw.cashbackPercent !== "number") return null;
  return {
    bannerTitle: raw.bannerTitle,
    bannerText: raw.bannerText,
    departurePlace: raw.departurePlace,
    cashbackPercent: Math.min(100, Math.max(0, Math.round(raw.cashbackPercent))),
  };
}

function readCatalog(): { tours: ManagedTour[]; settings: SiteSettings } | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(CATALOG_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { tours?: unknown; settings?: unknown };
    if (!Array.isArray(parsed.tours)) return null;
    const nextTours = parsed.tours.map(sanitizeTour).filter((tour): tour is ManagedTour => tour !== null);
    if (parsed.tours.length > 0 && nextTours.length === 0) return null;
    return { tours: nextTours, settings: readSettings(parsed.settings) ?? defaultSettings };
  } catch {
    return null;
  }
}

function readSession(): AdminSession | null {
  if (typeof sessionStorage === "undefined") return null;
  const raw = sessionStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as AdminSession;
    if (session.role !== "admin" || typeof session.email !== "string") return null;
    return session;
  } catch {
    return null;
  }
}

export function hydrateAdmin() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  const stored = readCatalog();
  const session = isSupabaseConfigured ? null : readSession();
  if (!stored && !session) return;
  state = {
    tours: stored?.tours ?? state.tours,
    settings: stored?.settings ?? state.settings,
    session: session?.role === "admin" ? session : null,
  };
  emit();
}

export function resolveTour(id: string): Tour | null {
  if (typeof localStorage !== "undefined") {
    const stored = readCatalog();
    if (stored) return stored.tours.find((tour) => tour.id === id) ?? null;
  }
  return getTourById(id) ?? null;
}

function syncPortal(tour: ManagedTour) {
  upsertPortalTour({
    id: tour.id,
    title: tour.title,
    departurePlace: tour.departurePlace,
    departureTime: tour.departureTime,
    departureDate: upcomingDepartureDate(tour.day),
    guideId: tour.guideId,
    driverId: tour.driverId,
  });
}

function asUuid(value: string | null) {
  if (!value) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : null;
}

async function pushTour(tour: ManagedTour) {
  if (!supabase) return;
  const { error } = await supabase.from("tours").upsert({
    id: tour.id,
    title: tour.title,
    departure_place: tour.departurePlace,
    departure_time: tour.departureTime,
    departure_date: upcomingDepartureDate(tour.day),
    price: tour.price,
    seats: tour.seatsLeft,
    image_url: tour.image,
    panorama_url: tour.panoramaUrl || null,
    summary: tour.summary,
    region: tour.region,
    day: tour.day,
    itinerary: tour.itinerary,
    audio_chapters: tour.audioChapters,
    guide_id: asUuid(tour.guideId),
    driver_id: asUuid(tour.driverId),
  });
  if (error) throw new Error("Supabase-ում չպահպանվեց։ Տեղային պատճենը թարմացվեց։");
}

export async function saveTour(tour: ManagedTour) {
  const toursNext = state.tours.some((item) => item.id === tour.id)
    ? state.tours.map((item) => (item.id === tour.id ? tour : item))
    : [...state.tours, tour];
  setState({ tours: toursNext });
  syncPortal(tour);
  await pushTour(tour);
}

export async function deleteTour(tourId: string) {
  setState({ tours: state.tours.filter((tour) => tour.id !== tourId) });
  removePortalTour(tourId);
  if (!supabase) return;
  const { error } = await supabase.from("tours").delete().eq("id", tourId);
  if (error) throw new Error("Supabase-ից չջնջվեց։ Տեղային ցանկից հանված է։");
}

export async function assignStaff(tourId: string, guideId: string | null, driverId: string | null) {
  const tour = state.tours.find((item) => item.id === tourId);
  if (!tour) throw new Error("Տուրը չի գտնվել։");
  const next = { ...tour, guideId, driverId };
  setState({ tours: state.tours.map((item) => (item.id === tourId ? next : item)) });
  assignPortalStaff(tourId, guideId, driverId);
  if (!supabase) return;
  const { error } = await supabase
    .from("tours")
    .update({ guide_id: asUuid(guideId), driver_id: asUuid(driverId) })
    .eq("id", tourId);
  if (error) throw new Error("Նշանակումը Supabase-ում չպահպանվեց։ Տեղային տարբերակը թարմացվեց։");
}

export async function saveSettings(settings: SiteSettings) {
  const next = {
    ...settings,
    cashbackPercent: Math.min(100, Math.max(0, Math.round(settings.cashbackPercent))),
  };
  const toursNext = state.tours.map((tour) => ({ ...tour, departurePlace: next.departurePlace }));
  setState({ settings: next, tours: toursNext });
  toursNext.forEach(syncPortal);
  if (!supabase) return;
  const { error } = await supabase.from("site_settings").upsert({
    id: 1,
    banner_title: next.bannerTitle,
    banner_text: next.bannerText,
    departure_place: next.departurePlace,
    cashback_percent: next.cashbackPercent,
  });
  if (error) throw new Error("Կարգավորումները Supabase-ում չպահպանվեցին։ Տեղային պատճենը թարմացվեց։");
}

export async function loadStaff(): Promise<StaffMember[]> {
  if (!supabase) return localStaff;
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, role")
    .in("role", ["guide", "driver"])
    .order("full_name");
  if (error) throw new Error("Անձնակազմի ցանկը չբեռնվեց։");
  return data.flatMap((row) => {
    if (row.role !== "guide" && row.role !== "driver") return [];
    return [{ id: row.id, fullName: row.full_name, role: row.role }];
  });
}

function bookingFromRow(row: {
  id: string;
  tour_id: string;
  passenger_name: string;
  phone: string;
  seat_number: number;
  ticket_code: string;
  status: BookingRecord["status"];
  adults: number;
  children: number;
  payment_provider: string | null;
  payment_status: string | null;
  amount: number;
}): BookingRecord {
  const provider: PaymentProviderName | null =
    row.payment_provider === "idram" || row.payment_provider === "telcell" || row.payment_provider === "arca"
      ? row.payment_provider
      : null;
  const paymentStatus: PaymentState | null =
    row.payment_status === "SUCCESS" || row.payment_status === "FAILED" || row.payment_status === "PENDING"
      ? row.payment_status
      : null;
  return {
    id: row.id,
    tourId: row.tour_id,
    passengerName: row.passenger_name,
    phone: row.phone,
    seatNumber: row.seat_number,
    ticketCode: row.ticket_code,
    status: row.status,
    adults: row.adults,
    children: row.children,
    paymentProvider: provider,
    paymentStatus,
    amount: row.amount,
  };
}

export async function loadAdminBookings(): Promise<BookingRecord[]> {
  if (!supabase) return getPortalSnapshot().bookings;
  const { data, error } = await supabase
    .from("bookings")
    .select(
      "id, tour_id, passenger_name, phone, seat_number, ticket_code, status, adults, children, payment_provider, payment_status, amount",
    )
    .order("seat_number");
  if (error) throw new Error("Ամրագրումները չբեռնվեցին։");
  return data.map(bookingFromRow);
}

export async function signInAdmin(email: string, password: string) {
  const trimmed = email.trim().toLowerCase();
  if (!supabase) {
    const localName = trimmed.split("@")[0] ?? "";
    if (!trimmed.includes("@") || password.length < 4 || localName !== "admin") {
      throw new Error("Ադմինի մուտքի համար օգտագործեք admin@arignank.am և առնվազն 4 նիշ գաղտնաբառ։");
    }
    const session: AdminSession = {
      id: "local-admin",
      fullName: "Ադմինիստրատոր",
      email: trimmed,
      role: "admin",
    };
    setState({ session });
    return session;
  }
  const { data, error } = await supabase.auth.signInWithPassword({ email: trimmed, password });
  if (error || !data.user) throw new Error("Էլ. փոստը կամ գաղտնաբառը սխալ է։");
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, full_name, email, role")
    .eq("id", data.user.id)
    .maybeSingle();
  if (profileError || !profile || profile.role !== "admin") {
    await supabase.auth.signOut();
    throw new Error("Այս հաշիվը ադմինիստրատոր չէ։");
  }
  const session: AdminSession = {
    id: profile.id,
    fullName: profile.full_name,
    email: profile.email ?? trimmed,
    role: "admin",
  };
  setState({ session });
  return session;
}

export function signInMockAdmin() {
  return signInAdmin("admin@arignank.am", "admin");
}

export async function signOutAdmin() {
  setState({ session: null });
  if (supabase) await supabase.auth.signOut();
}

export async function restoreAdminSession() {
  hydrateAdmin();
  if (!supabase) return state.session;
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) {
    setState({ session: null });
    return null;
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, email, role")
    .eq("id", userId)
    .maybeSingle();
  if (!profile || profile.role !== "admin") {
    setState({ session: null });
    return null;
  }
  const session: AdminSession = {
    id: profile.id,
    fullName: profile.full_name,
    email: profile.email ?? "",
    role: "admin",
  };
  setState({ session });
  return session;
}
