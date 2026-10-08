import garniPhoto from "@/assets/tour-garni.jpg";
import sevanPhoto from "@/assets/tour-sevan.jpg";
import tatevPhoto from "@/assets/tour-tatev.jpg";
import { getTourById, regions, tours, type AudioChapter, type Hotspot, type ItineraryStop, type Tour } from "@/data/tours";
import type { PaymentProviderName, PaymentState, UserRole } from "@/lib/database.types";
import {
  assignPortalStaff,
  getPortalSnapshot,
  LOCAL_DRIVER_ID,
  LOCAL_STAFF_ID,
  clearGuideProfile,
  openGuideSession,
  removePortalTour,
  upcomingDepartureDate,
  upsertPortalTour,
  type BookingRecord,
} from "@/lib/guide-api";
import { columnsToLocalized, localized, type LocalizedText } from "@/lib/locale";
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

export type DirectoryUser = {
  id: string;
  fullName: string;
  phone: string;
  email: string;
  password: string;
  role: UserRole;
  avatarUrl: string;
  bio: string;
  birthDate: string;
  createdAt?: string;
};

export type StaffMember = DirectoryUser & { role: "guide" | "driver" };

type AdminState = {
  tours: ManagedTour[];
  settings: SiteSettings;
  users: DirectoryUser[];
  session: AdminSession | null;
};

export function seedUsers(): DirectoryUser[] {
  return [
    {
      id: LOCAL_STAFF_ID,
      fullName: "Արմավիրի ուղեկցորդ",
      phone: "+37494111001",
      email: "guide@arignank.am",
      password: "guide1234",
      role: "guide",
      birthDate: "",
      avatarUrl: garniPhoto,
      bio: "Պատմում է Գառնու և Գեղարդի մասին պարզ, հանգիստ շեշտով։",
    },
    {
      id: "local-guide-ani",
      fullName: "Անի Գրիգորյան",
      phone: "+37494111002",
      email: "ani@arignank.am",
      password: "guide1234",
      role: "guide",
      birthDate: "",
      avatarUrl: sevanPhoto,
      bio: "Մշակութային տուրերի զբոսավար, սիրում է վանքերի պատմությունը։",
    },
    {
      id: "local-guide-hayk",
      fullName: "Հայկ Սարգսյան",
      phone: "+37494111003",
      email: "hayk@arignank.am",
      password: "guide1234",
      role: "guide",
      birthDate: "",
      avatarUrl: tatevPhoto,
      bio: "Լեռնային երթուղիների զբոսավար, ուշադիր է խմբի տեմպին։",
    },
    {
      id: LOCAL_DRIVER_ID,
      fullName: "Արմեն Ավետիսյան",
      phone: "+37494111004",
      email: "armen@arignank.am",
      password: "driver1234",
      role: "driver",
      birthDate: "",
      avatarUrl: garniPhoto,
      bio: "Արմավիրից մեկնող խմբերի վարորդ, ճանապարհը գիտի ժամով։",
    },
    {
      id: "local-driver-narek",
      fullName: "Նարեկ Հովհաննիսյան",
      phone: "+37494111005",
      email: "narek@arignank.am",
      password: "driver1234",
      role: "driver",
      birthDate: "",
      avatarUrl: sevanPhoto,
      bio: "Հանգիստ վարում է լեռնային ճանապարհներին և օգնում է կանգառներում։",
    },
    {
      id: "local-tourist-ani",
      fullName: "Անի Հակոբյան",
      phone: "+37491111222",
      email: "",
      password: "",
      role: "tourist",
      avatarUrl: "",
      bio: "",
      birthDate: "1994-05-12",
      createdAt: "2026-09-12T08:00:00.000Z",
    },
  ];
}

const CATALOG_KEY = "ari-gnank-catalog";
const SESSION_KEY = "ari-gnank-admin-session";
const TOURIST_KEY = "ari-gnank-tourist-session";

export type TouristSession = {
  id: string;
  fullName: string;
  phone: string;
  email: string;
  role: "tourist" | "guide" | "driver";
  token: string;
};

export const defaultSettings: SiteSettings = {
  bannerTitle: "Բացահայտիր Հայաստանը\nմեկ օրում",
  bannerText:
    "Հնագույն վանքեր, լեռնային լճեր ու անմոռանալի տեսարաններ՝ փոքր խմբերով ճանապարհորդություններ, որոնք սկսվում են Արմավիրից։",
  departurePlace: "Արմավիր քաղաք, Կենտրոնական հրապարակ",
  cashbackPercent: 5,
};

const fallbackImage = tours[0]?.image_url ?? "";

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
  users: seedUsers(),
  session: null,
};

let state: AdminState = serverSnapshot;
let tourist: TouristSession | null = null;
let hydrated = false;
const listeners = new Set<() => void>();
const touristListeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function emitTourist() {
  touristListeners.forEach((listener) => listener());
}

function persist() {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(
    CATALOG_KEY,
    JSON.stringify({ tours: state.tours, settings: state.settings, users: state.users }),
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

export function subscribeTourist(listener: () => void) {
  touristListeners.add(listener);
  return () => touristListeners.delete(listener);
}

export function getTouristSnapshot() {
  return tourist;
}

export function getTouristServerSnapshot(): TouristSession | null {
  return null;
}

export function signOutTourist() {
  const role = tourist?.role;
  tourist = null;
  if (typeof localStorage !== "undefined") localStorage.removeItem(TOURIST_KEY);
  emitTourist();
  if (role === "guide") clearGuideProfile();
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

function readLocalized(value: unknown, fallback: LocalizedText, fillFromSeed = false): LocalizedText {
  if (value == null || value === "") return fallback;
  const next = localized(value);
  if (!next.hy.trim()) next.hy = fallback.hy;
  if (fillFromSeed && typeof value === "string") {
    if (!next.en.trim()) next.en = fallback.en;
    if (!next.ru.trim()) next.ru = fallback.ru;
  }
  return next;
}

function readColumn(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function readTriplet(
  raw: Record<string, unknown>,
  hyKey: string,
  enKey: string,
  ruKey: string,
  objectKey: string,
  fallback: LocalizedText,
) {
  const fromObject = readLocalized(raw[objectKey], fallback, true);
  return {
    hy: readColumn(raw[hyKey], fromObject.hy || fallback.hy),
    en: readColumn(raw[enKey], fromObject.en || fallback.en),
    ru: readColumn(raw[ruKey], fromObject.ru || fallback.ru),
  };
}

function sanitizeTour(value: unknown): ManagedTour | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<ManagedTour> & Record<string, unknown>;
  if (typeof raw.id !== "string") return null;
  const base = getTourById(raw.id);
  const title = readTriplet(
    raw,
    "title_hy",
    "title_en",
    "title_ru",
    "title",
    base ? columnsToLocalized(base.title_hy, base.title_en, base.title_ru) : localized(""),
  );
  if (!title.hy.trim()) return null;
  const description = readTriplet(
    raw,
    "description_hy",
    "description_en",
    "description_ru",
    "summary",
    base ? columnsToLocalized(base.description_hy, base.description_en, base.description_ru) : localized(""),
  );
  const location = readTriplet(
    raw,
    "location_hy",
    "location_en",
    "location_ru",
    "region",
    base
      ? columnsToLocalized(base.location_hy, base.location_en, base.location_ru)
      : regions[0] ?? localized("Արմավիր"),
  );
  const image =
    typeof raw.image_url === "string" && raw.image_url
      ? raw.image_url
      : typeof raw["image"] === "string" && raw["image"]
        ? raw["image"]
        : base?.image_url ?? fallbackImage;
  if (!image) return null;
  const type = raw.type === "Արշավային" || raw.type === "Մշակութային" || raw.type === "Էքստրեմալ"
    ? raw.type
    : base?.type ?? "Մշակութային";
  const tour: ManagedTour = {
    id: raw.id,
    title_hy: title.hy,
    title_en: title.en,
    title_ru: title.ru,
    description_hy: description.hy,
    description_en: description.en,
    description_ru: description.ru,
    location_hy: location.hy,
    location_en: location.en,
    location_ru: location.ru,
    image_url: image,
    category: typeof raw.category === "string" && raw.category ? raw.category : location.hy,
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
    is_virtual_only: typeof raw.is_virtual_only === "boolean" ? raw.is_virtual_only : base?.is_virtual_only === true,
    guideId: typeof raw.guideId === "string" || raw.guideId === null ? raw.guideId : base ? LOCAL_STAFF_ID : null,
    driverId: typeof raw.driverId === "string" || raw.driverId === null ? raw.driverId : base ? LOCAL_DRIVER_ID : null,
  };
  if (typeof raw.oldPrice === "number") tour.oldPrice = raw.oldPrice;
  else if (base?.oldPrice !== undefined) tour.oldPrice = base.oldPrice;
  const virtualUrl = typeof raw.virtual_tour_url === "string" ? raw.virtual_tour_url.trim() : base?.virtual_tour_url ?? "";
  if (virtualUrl) tour.virtual_tour_url = virtualUrl;
  const linked = typeof raw.virtual_tour_id === "string"
    ? raw.virtual_tour_id.trim()
    : raw.virtual_tour_id === null
      ? ""
      : base?.virtual_tour_id?.trim() ?? "";
  tour.virtual_tour_id = linked && linked !== tour.id ? linked : null;
  return tour;
}

function clearBrokenLinks(tours: ManagedTour[]) {
  const virtualIds = new Set(tours.filter((tour) => tour.is_virtual_only === true).map((tour) => tour.id));
  return tours.map((tour) => {
    const linked = tour.virtual_tour_id?.trim() ?? "";
    if (!linked || tour.is_virtual_only || !virtualIds.has(linked)) {
      return linked || tour.is_virtual_only ? { ...tour, virtual_tour_id: null } : tour;
    }
    return tour;
  });
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

function isUserRole(value: unknown): value is UserRole {
  return value === "tourist" || value === "guide" || value === "driver" || value === "admin";
}

function normalizeRole(value: unknown): UserRole {
  if (value === "customer") return "tourist";
  return isUserRole(value) ? value : "tourist";
}

function sanitizeUser(value: unknown): DirectoryUser | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<DirectoryUser> & { role?: unknown };
  if (typeof raw.id !== "string" || !raw.id.trim()) return null;
  if (typeof raw.fullName !== "string" || !raw.fullName.trim()) return null;
  const seeded = seedUsers().find((user) => user.id === raw.id);
  return {
    id: raw.id,
    fullName: raw.fullName.trim(),
    phone: typeof raw.phone === "string" ? raw.phone : "",
    email: typeof raw.email === "string" ? raw.email : "",
    password: typeof raw.password === "string" && raw.password ? raw.password : seeded?.password ?? "",
    role: normalizeRole(raw.role),
    avatarUrl: typeof raw.avatarUrl === "string" ? raw.avatarUrl : "",
    bio: typeof raw.bio === "string" ? raw.bio : "",
    birthDate: typeof raw.birthDate === "string" ? raw.birthDate : seeded?.birthDate ?? "",
    ...(typeof raw.createdAt === "string" && raw.createdAt
      ? { createdAt: raw.createdAt }
      : seeded?.createdAt
        ? { createdAt: seeded.createdAt }
        : {}),
  };
}

function readUsers(value: unknown): DirectoryUser[] | null {
  if (!Array.isArray(value)) return null;
  const users = value.flatMap((item) => {
    const user = sanitizeUser(item);
    return user ? [user] : [];
  });
  return users.length > 0 ? users : null;
}

function readCatalog(): { tours: ManagedTour[]; settings: SiteSettings; users: DirectoryUser[] | null } | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(CATALOG_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { tours?: unknown; settings?: unknown; users?: unknown };
    if (!Array.isArray(parsed.tours)) return null;
    const nextTours = clearBrokenLinks(parsed.tours.map(sanitizeTour).filter((tour): tour is ManagedTour => tour !== null));
    if (parsed.tours.length > 0 && nextTours.length === 0) return null;
    return {
      tours: nextTours,
      settings: readSettings(parsed.settings) ?? defaultSettings,
      users: readUsers(parsed.users),
    };
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

function readTourist(users: DirectoryUser[]): TouristSession | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(TOURIST_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<TouristSession>;
    if (
      (value.role !== "tourist" && value.role !== "guide" && value.role !== "driver") ||
      typeof value.id !== "string" ||
      typeof value.token !== "string"
    ) {
      return null;
    }
    const user = users.find((item) => item.id === value.id);
    if (!user || (user.role !== "tourist" && user.role !== "guide" && user.role !== "driver")) return null;
    return {
      id: user.id,
      fullName: user.fullName,
      phone: user.phone,
      email: user.email,
      role: user.role,
      token: value.token,
    };
  } catch {
    return null;
  }
}

function openAccountSession(user: DirectoryUser, token: string) {
  if (user.role !== "tourist" && user.role !== "guide" && user.role !== "driver") {
    throw new Error("Այս հաշիվով մուտքը այստեղ հասանելի չէ։");
  }
  const session: TouristSession = {
    id: user.id,
    fullName: user.fullName,
    phone: user.phone,
    email: user.email,
    role: user.role,
    token,
  };
  tourist = session;
  if (typeof localStorage !== "undefined") localStorage.setItem(TOURIST_KEY, JSON.stringify(session));
  emitTourist();
  return session;
}

export function refreshStoredDirectory() {
  if (typeof localStorage === "undefined") return;
  const stored = readCatalog();
  if (!stored?.users) return;
  const changed = stored.users.some((user) => {
    const current = state.users.find((item) => item.id === user.id);
    return (
      !current ||
      current.role !== user.role ||
      current.fullName !== user.fullName ||
      current.phone !== user.phone ||
      current.email !== user.email ||
      current.password !== user.password ||
      current.avatarUrl !== user.avatarUrl ||
      current.bio !== user.bio
    );
  }) || stored.users.length !== state.users.length;
  if (changed) setState({ users: stored.users });
  const nextTourist = readTourist(state.users);
  if (!nextTourist) {
    if (tourist?.role === "guide") clearGuideProfile();
    if (tourist) {
      tourist = null;
      localStorage.removeItem(TOURIST_KEY);
      emitTourist();
    }
    return;
  }
  if (
    !tourist ||
    tourist.id !== nextTourist.id ||
    tourist.role !== nextTourist.role ||
    tourist.fullName !== nextTourist.fullName ||
    tourist.phone !== nextTourist.phone ||
    tourist.email !== nextTourist.email
  ) {
    tourist = nextTourist;
    localStorage.setItem(TOURIST_KEY, JSON.stringify(nextTourist));
    emitTourist();
  }
}

export function hydrateAdmin() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  const stored = readCatalog();
  const session = isSupabaseConfigured ? null : readSession();
  const users = stored?.users ?? seedUsers();
  if (stored || session) {
    state = {
      tours: stored?.tours ?? state.tours,
      settings: stored?.settings ?? state.settings,
      users,
      session: session?.role === "admin" ? session : null,
    };
    emit();
  }
  const nextTourist = readTourist(state.users);
  if (!nextTourist && typeof localStorage !== "undefined" && localStorage.getItem(TOURIST_KEY)) {
    localStorage.removeItem(TOURIST_KEY);
  }
  tourist = nextTourist;
  emitTourist();
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
    title: tour.title_hy,
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

function virtualRecord(tour: ManagedTour) {
  return {
    id: tour.id,
    title_hy: tour.title_hy,
    title_en: tour.title_en,
    title_ru: tour.title_ru,
    description_hy: tour.description_hy,
    description_en: tour.description_en,
    description_ru: tour.description_ru,
    embed_url: tour.virtual_tour_url || tour.panoramaUrl || null,
    thumbnail_url: tour.image_url || null,
  };
}

async function pushVirtualRecord(tour: ManagedTour) {
  if (!supabase || tour.is_virtual_only !== true) return;
  const { error } = await supabase.from("virtual_tours").upsert(virtualRecord(tour));
  if (error) throw new Error("Supabase-ում վիրտուալ տուրը չպահպանվեց։ Տեղային պատճենը թարմացվեց։");
}

async function pushTour(tour: ManagedTour) {
  if (!supabase) return;
  if (tour.is_virtual_only) {
    await pushVirtualRecord(tour);
  } else {
    const { error: dropError } = await supabase.from("virtual_tours").delete().eq("id", tour.id);
    if (dropError) throw new Error("Supabase-ում չպահպանվեց։ Տեղային պատճենը թարմացվեց։");
  }
  if (!tour.is_virtual_only && tour.virtual_tour_id) {
    const linked = state.tours.find((item) => item.id === tour.virtual_tour_id && item.is_virtual_only === true);
    if (linked) await pushVirtualRecord(linked);
  }
  const { error } = await supabase.from("tours").upsert({
    id: tour.id,
    title_hy: tour.title_hy,
    title_en: tour.title_en,
    title_ru: tour.title_ru,
    description_hy: tour.description_hy,
    description_en: tour.description_en,
    description_ru: tour.description_ru,
    location_hy: tour.location_hy,
    location_en: tour.location_en,
    location_ru: tour.location_ru,
    price: tour.price,
    image_url: tour.image_url,
    category: tour.category,
  });
  if (error) throw new Error("Supabase-ում չպահպանվեց։ Տեղային պատճենը թարմացվեց։");
}

export async function saveTour(tour: ManagedTour) {
  const saved: ManagedTour = tour.is_virtual_only ? { ...tour, virtual_tour_id: null } : tour;
  const replaced = state.tours.some((item) => item.id === saved.id)
    ? state.tours.map((item) => (item.id === saved.id ? saved : item))
    : [...state.tours, saved];
  const toursNext = saved.is_virtual_only
    ? replaced
    : replaced.map((item) => (item.id !== saved.id && item.virtual_tour_id === saved.id ? { ...item, virtual_tour_id: null } : item));
  setState({ tours: clearBrokenLinks(toursNext) });
  if (saved.is_virtual_only) removePortalTour(saved.id);
  else syncPortal(saved);
  await pushTour(saved);
}

export async function deleteTour(tourId: string) {
  const remaining = state.tours
    .filter((tour) => tour.id !== tourId)
    .map((tour) => (tour.virtual_tour_id === tourId ? { ...tour, virtual_tour_id: null } : tour));
  setState({ tours: remaining });
  removePortalTour(tourId);
  if (!supabase) return;
  const { error: virtualError } = await supabase.from("virtual_tours").delete().eq("id", tourId);
  if (virtualError) throw new Error("Supabase-ից չջնջվեց։ Տեղային ցանկից հանված է։");
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
  const departureDate = upcomingDepartureDate(tour.day);
  const payload = {
    tour_id: tourId,
    departure_date: departureDate,
    available_seats: tour.seatsLeft,
    guide_id: asUuid(guideId),
    driver_id: asUuid(driverId),
  };
  const { data: existing, error: lookupError } = await supabase
    .from("departures")
    .select("id")
    .eq("tour_id", tourId)
    .eq("departure_date", departureDate)
    .maybeSingle();
  if (lookupError) throw new Error("Նշանակումը Supabase-ում չպահպանվեց։ Տեղային տարբերակը թարմացվեց։");
  const { error } = existing
    ? await supabase.from("departures").update(payload).eq("id", existing.id)
    : await supabase.from("departures").insert(payload);
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

function userFromRow(row: {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  role: string;
  avatar_url: string | null;
  bio: string | null;
  birth_date: string | null;
}): DirectoryUser {
  return {
    id: row.id,
    fullName: row.full_name,
    phone: row.phone ?? "",
    email: row.email ?? "",
    password: "",
    role: normalizeRole(row.role),
    avatarUrl: row.avatar_url ?? "",
    bio: row.bio ?? "",
    birthDate: row.birth_date ?? "",
  };
}

export async function loadDirectory(): Promise<DirectoryUser[]> {
  if (!supabase) return state.users;
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, phone, email, role, avatar_url, bio, birth_date")
    .order("full_name");
  if (error) throw new Error("Օգտատերերի ցանկը չբեռնվեց։");
  return data.map(userFromRow);
}

export async function loadStaff(): Promise<StaffMember[]> {
  const users = await loadDirectory();
  return users.filter((user): user is StaffMember => user.role === "guide" || user.role === "driver");
}

export async function updateDirectoryUser(next: DirectoryUser) {
  const saved: DirectoryUser = {
    ...next,
    fullName: next.fullName.trim(),
    phone: next.phone.trim(),
    email: next.email.trim(),
    avatarUrl: next.avatarUrl.trim(),
    bio: next.bio.trim(),
    role: normalizeRole(next.role),
  };
  if (!saved.fullName) throw new Error("Գրեք օգտատիրոջ անունը։");
  const emailKey = saved.email.trim().toLowerCase();
  if (
    emailKey &&
    state.users.some((user) => user.id !== saved.id && user.email.trim().toLowerCase() === emailKey)
  ) {
    throw new Error("Այս էլ. փոստով հաշիվ արդեն կա։");
  }
  const known = state.users.some((user) => user.id === saved.id);
  if (!supabase && !known) throw new Error("Օգտատերը չի գտնվել։");
  if (known || !supabase) {
    const previousTours = state.tours;
    const tours = previousTours.map((tour) => ({
      ...tour,
      guideId: tour.guideId === saved.id && saved.role !== "guide" ? null : tour.guideId,
      driverId: tour.driverId === saved.id && saved.role !== "driver" ? null : tour.driverId,
    }));
    setState({
      users: known ? state.users.map((user) => (user.id === saved.id ? saved : user)) : state.users,
      tours,
    });
    tours.forEach((tour) => {
      if (tour.is_virtual_only) return;
      const previous = previousTours.find((item) => item.id === tour.id);
      if (!previous || previous.guideId !== tour.guideId || previous.driverId !== tour.driverId) {
        syncPortal(tour);
      }
    });
    const activeGuide = getPortalSnapshot().profile;
    if (activeGuide?.id === saved.id) {
      if (saved.role === "guide") {
        openGuideSession({
          id: saved.id,
          fullName: saved.fullName,
          phone: saved.phone,
          email: saved.email,
          role: "guide",
        });
      } else {
        clearGuideProfile();
      }
    }
    if (tourist?.id === saved.id) {
      if (saved.role === "tourist" || saved.role === "guide" || saved.role === "driver") {
        openAccountSession(saved, tourist.token);
      } else signOutTourist();
    }
  }
  if (!supabase) return;
  const { error } = await supabase
    .from("profiles")
    .update({
      role: saved.role,
      avatar_url: saved.avatarUrl || null,
      bio: saved.bio || null,
      phone: saved.phone || null,
    })
    .eq("id", saved.id);
  if (error) throw new Error("Օգտատերը Supabase-ում չպահպանվեց։ Տեղային պատճենը թարմացվեց։");
  if (saved.role !== "guide") {
    await supabase.from("departures").update({ guide_id: null }).eq("guide_id", saved.id);
  }
  if (saved.role !== "driver") {
    await supabase.from("departures").update({ driver_id: null }).eq("driver_id", saved.id);
  }
}

function bookingFromRow(row: {
  id: string;
  tour_id: string | null;
  passenger_name: string | null;
  phone: string | null;
  seat_number: number;
  ticket_code: string | null;
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
    tourId: row.tour_id ?? "",
    passengerName: row.passenger_name ?? "",
    phone: row.phone ?? "",
    seatNumber: row.seat_number,
    ticketCode: row.ticket_code ?? "",
    status: row.status,
    adults: row.adults,
    children: row.children,
    paymentProvider: provider,
    paymentStatus,
    amount: row.amount,
    attendance: null,
  };
}

function emailTaken(email: string) {
  const key = email.trim().toLowerCase();
  return state.users.some((user) => user.email.trim().toLowerCase() === key);
}

function validAccountEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function validAccountPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15;
}

export async function registerTourist(input: {
  fullName: string;
  phone: string;
  birthDate: string;
  email: string;
  password: string;
}) {
  const fullName = input.fullName.trim();
  const phone = input.phone.trim();
  const email = input.email.trim().toLowerCase();
  const birthDate = input.birthDate.trim();
  if (fullName.length < 2) throw new Error("Գրեք անունը և ազգանունը։");
  if (!validAccountPhone(phone)) throw new Error("Գրեք գործող հեռախոսահամար։");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) throw new Error("Ընտրեք ծննդյան ամսաթիվը։");
  if (!validAccountEmail(email)) throw new Error("Գրեք գործող էլ. փոստ։");
  if (input.password.length < 4) throw new Error("Գաղտնաբառը առնվազն 4 նիշ պետք է լինի։");
  if (emailTaken(email)) throw new Error("Այս էլ. փոստով հաշիվ արդեն կա։");
  const account: DirectoryUser = {
    id: `tourist-${crypto.randomUUID()}`,
    fullName,
    phone,
    email,
    password: input.password,
    role: "tourist",
    avatarUrl: "",
    bio: "",
    birthDate,
    createdAt: new Date().toISOString(),
  };
  setState({ users: [...state.users, account] });
  let token: string = crypto.randomUUID();
  if (supabase) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password: input.password,
      options: {
        data: { full_name: fullName, role: "tourist", phone, birth_date: birthDate },
      },
    });
    if (error) throw new Error("Գրանցումը Supabase-ում չպահվեց։ Տեղային հաշիվը ստեղծված է։");
    if (data.session?.access_token) token = data.session.access_token;
  }
  return openAccountSession(account, token);
}

export async function signInTourist(identifier: string, password: string) {
  hydrateAdmin();
  refreshStoredDirectory();
  const raw = identifier.trim();
  const byEmail = raw.includes("@");
  const digits = raw.replace(/\D/g, "");
  const user = state.users.find((item) => {
    if (!item.password || item.password !== password) return false;
    if (byEmail) return item.email.trim().toLowerCase() === raw.toLowerCase();
    return digits.length >= 8 && item.phone.replace(/\D/g, "") === digits;
  });
  if (!user) throw new Error("Էլ. փոստը, հեռախոսը կամ գաղտնաբառը սխալ է։");
  if (user.role !== "tourist" && user.role !== "guide" && user.role !== "driver") {
    throw new Error("Այս հաշիվով մուտքը այստեղ հասանելի չէ։");
  }
  let token: string = crypto.randomUUID();
  if (supabase && byEmail) {
    const { data, error } = await supabase.auth.signInWithPassword({ email: user.email, password });
    if (error || !data.session) throw new Error("Էլ. փոստը կամ գաղտնաբառը սխալ է։");
    token = data.session.access_token;
  }
  if (user.role === "guide") {
    openGuideSession({
      id: user.id,
      fullName: user.fullName,
      phone: user.phone,
      email: user.email,
      role: "guide",
    });
  } else {
    clearGuideProfile();
  }
  return openAccountSession(user, token);
}

export async function createStaffAccount(input: {
  role: "guide" | "driver";
  fullName: string;
  phone: string;
  email: string;
  password: string;
  avatarUrl: string;
  bio: string;
}) {
  const fullName = input.fullName.trim();
  const phone = input.phone.trim();
  const email = input.email.trim().toLowerCase();
  if (input.role !== "guide" && input.role !== "driver") throw new Error("Ընտրեք զբոսավար կամ վարորդ։");
  const role = input.role === "driver" ? "driver" : "guide";
  if (fullName.length < 2) throw new Error("Գրեք անունը և ազգանունը։");
  if (!validAccountPhone(phone)) throw new Error("Գրեք գործող հեռախոսահամար։");
  if (!validAccountEmail(email)) throw new Error("Գրեք գործող էլ. փոստ։");
  if (input.password.length < 4) throw new Error("Գաղտնաբառը առնվազն 4 նիշ պետք է լինի։");
  if (emailTaken(email)) throw new Error("Այս էլ. փոստով հաշիվ արդեն կա։");
  const account: DirectoryUser = {
    id: `staff-${crypto.randomUUID()}`,
    fullName,
    phone,
    email,
    password: input.password,
    role,
    avatarUrl: input.avatarUrl.trim(),
    bio: input.bio.trim(),
    birthDate: "",
  };
  setState({ users: [...state.users, account] });
  return account;
}

export async function signInGuide(email: string, password: string) {
  hydrateAdmin();
  refreshStoredDirectory();
  const key = email.trim().toLowerCase();
  if (!supabase) {
    const user = state.users.find((item) => item.email.trim().toLowerCase() === key);
    if (!user || user.role !== "guide" || user.password !== password) {
      throw new Error("Էլ. փոստը կամ գաղտնաբառը սխալ է, կամ հաշիվը զբոսավար չէ։");
    }
    openGuideSession({
      id: user.id,
      fullName: user.fullName,
      phone: user.phone,
      email: user.email,
      role: "guide",
    });
    openAccountSession(user, crypto.randomUUID());
    return user;
  }
  const { data, error } = await supabase.auth.signInWithPassword({ email: key, password });
  if (error || !data.user) throw new Error("Էլ. փոստը կամ գաղտնաբառը սխալ է։");
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, full_name, phone, email, role")
    .eq("id", data.user.id)
    .maybeSingle();
  if (profileError || !profile || profile.role !== "guide") {
    await supabase.auth.signOut();
    throw new Error("Այս հաշիվը զբոսավար չէ։");
  }
  openGuideSession({
    id: profile.id,
    fullName: profile.full_name,
    phone: profile.phone ?? "",
    email: profile.email ?? key,
    role: "guide",
  });
  openAccountSession(
    {
      id: profile.id,
      fullName: profile.full_name,
      phone: profile.phone ?? "",
      email: profile.email ?? key,
      password: "",
      role: "guide",
      avatarUrl: "",
      bio: "",
      birthDate: "",
    },
    data.session.access_token,
  );
  return profile;
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
