import garniPhoto from "@/assets/tour-garni.jpg";
import sevanPhoto from "@/assets/tour-sevan.jpg";
import tatevPhoto from "@/assets/tour-tatev.jpg";
import { getTourById, tours, type Tour } from "@/data/tours";
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
import { loadPublicStaff, type PublicStaffMember } from "@/lib/crew";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { Database } from "@/types/supabase";
import {
  deserializeSiteSettings,
  deserializeTourCatalog,
  deserializeVirtualTour,
  logRemoteError,
  mergeCatalogTours,
  normalizeCatalogTour,
  remoteWriteCommitsLocally,
  serializeSiteSettings,
  serializeTourCatalog,
  serializeVirtualTour,
  type CatalogTour,
} from "@/lib/tour-catalog-record";

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
  catalogError: string | null;
  settingsError: string | null;
};

function canUseLocalDevSeeds() {
  return Boolean(import.meta.env.DEV) && !isSupabaseConfigured;
}

export function seedUsers(): DirectoryUser[] {
  if (!canUseLocalDevSeeds()) return [];
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
    {
      id: "local-admin",
      fullName: "Ադմինիստրատոր",
      phone: "+37410000000",
      email: "dev-admin@localhost",
      password: "",
      role: "admin",
      birthDate: "",
      avatarUrl: "",
      bio: "Արի Գնանք կայքի ադմինիստրատոր։",
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

function seedManaged(): ManagedTour[] {
  return tours.map((tour) => ({
    ...tour,
    panoramaUrl: tour.panoramaUrl ?? "",
    guideId: LOCAL_STAFF_ID,
    driverId: LOCAL_DRIVER_ID,
  }));
}

const serverSnapshot: AdminState = {
  tours: canUseLocalDevSeeds() ? seedManaged() : [],
  settings: defaultSettings,
  users: seedUsers(),
  session: null,
  catalogError: null,
  settingsError: null,
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
  if (typeof sessionStorage !== "undefined") {
    if (!state.session) sessionStorage.removeItem(SESSION_KEY);
    else sessionStorage.setItem(SESSION_KEY, JSON.stringify(state.session));
  }
  if (isSupabaseConfigured || typeof localStorage === "undefined") return;
  localStorage.setItem(
    CATALOG_KEY,
    JSON.stringify({ tours: state.tours, settings: state.settings, users: state.users }),
  );
}

function setState(patch: Partial<AdminState>) {
  state = { ...state, ...patch };
  persist();
  emit();
}

function asManaged(tour: CatalogTour | null): ManagedTour | null {
  return tour;
}

function weekendFromLegacyDate(value: string | null | undefined): "saturday" | "sunday" | undefined {
  if (!value) return undefined;
  const day = new Date(`${value}T12:00:00`).getDay();
  if (day === 0) return "sunday";
  if (day === 6) return "saturday";
  return undefined;
}

function managedFromLiveTour(row: Record<string, unknown>): ManagedTour | null {
  const tour = deserializeTourCatalog(row);
  if (!tour) return null;
  const dayMissing = row["day"] == null || row["day"] === "";
  const weekend = weekendFromLegacyDate(typeof row["departure_date"] === "string" ? row["departure_date"] : null);
  if (dayMissing && weekend) tour.day = weekend;
  return asManaged(tour);
}

function managedFromLiveVirtual(row: Record<string, unknown>): ManagedTour | null {
  return asManaged(deserializeVirtualTour(row));
}

function applyDepartures(
  catalog: ManagedTour[],
  departures: { tour_id: string; available_seats: number; guide_id: string | null; driver_id: string | null }[],
) {
  if (departures.length === 0) return catalog;
  const latest = new Map<string, (typeof departures)[number]>();
  for (const row of departures) latest.set(row.tour_id, row);
  return catalog.map((tour) => {
    const assigned = latest.get(tour.id);
    if (!assigned) return tour;
    return {
      ...tour,
      seatsLeft: assigned.available_seats,
      guideId: assigned.guide_id,
      driverId: assigned.driver_id,
    };
  });
}

let liveCatalogRequest = 0;

function userFromPublicStaff(staff: PublicStaffMember): StaffMember {
  return {
    id: staff.id,
    fullName: staff.fullName,
    phone: "",
    email: "",
    password: "",
    role: staff.role,
    avatarUrl: staff.avatarUrl,
    bio: "",
    birthDate: "",
  };
}

async function loadCatalogStaff(): Promise<DirectoryUser[]> {
  const publicStaff = await loadPublicStaff();
  return publicStaff.map(userFromPublicStaff);
}

function throwRemote(action: string, fallback: string, error: unknown): never {
  logRemoteError(action, error);
  throw new Error(fallback);
}

async function refreshLiveCatalog() {
  if (!isSupabaseConfigured || !supabase) return;
  const request = ++liveCatalogRequest;
  try {
    const [toursResult, virtualResult, departuresResult, settingsResult, staff] = await Promise.all([
      supabase.from("tours").select("*").order("id"),
      supabase.from("virtual_tours").select("*").order("id"),
      supabase.from("departures").select("tour_id, available_seats, guide_id, driver_id, departure_date").order("departure_date"),
      supabase.from("site_settings").select("id, banner_title, banner_text, departure_place, cashback_percent").eq("id", 1).maybeSingle(),
      loadCatalogStaff(),
    ]);
    if (request !== liveCatalogRequest) return;
    if (toursResult.error) {
      logRemoteError("tours.select", toursResult.error);
      setState({
        users: staff,
        catalogError: "Տուրերը չբեռնվեցին Supabase-ից։ Ցանկը չի փոխարինվել տեղային օրինակով։",
      });
      return;
    }
    if (virtualResult.error) {
      logRemoteError("virtual_tours.select", virtualResult.error);
      setState({
        users: staff,
        catalogError: "Վիրտուալ տուրերը չբեռնվեցին Supabase-ից։ Ցանկը ամբողջությամբ չթարմացվեց։",
      });
      return;
    }
    const physical = (toursResult.data ?? [])
      .map((row) => managedFromLiveTour(row as Record<string, unknown>))
      .filter((tour): tour is ManagedTour => tour !== null);
    const virtualTours = (virtualResult.data ?? [])
      .map((row) => managedFromLiveVirtual(row as Record<string, unknown>))
      .filter((tour): tour is ManagedTour => tour !== null);
    let next = mergeCatalogTours(physical, virtualTours);
    if (!departuresResult.error && departuresResult.data) {
      next = applyDepartures(next, departuresResult.data);
    } else if (departuresResult.error) {
      logRemoteError("departures.select", departuresResult.error);
    }
    next = clearBrokenLinks(next);
    let settings = state.settings;
    let settingsError: string | null = null;
    if (settingsResult.error) {
      logRemoteError("site_settings.select", settingsResult.error);
      settingsError = "Կայքի կարգավորումները չբեռնվեցին Supabase-ից։";
    } else if (!settingsResult.data) {
      settings = defaultSettings;
    } else {
      settings = deserializeSiteSettings(settingsResult.data, defaultSettings) ?? defaultSettings;
    }
    setState({ tours: next, users: staff, settings, catalogError: null, settingsError });
    next.forEach((tour) => {
      if (tour.is_virtual_only !== true) syncPortal(tour);
    });
  } catch (error) {
    if (request !== liveCatalogRequest) return;
    logRemoteError("catalog.refresh", error);
    setState({
      catalogError: "Տուրերը չբեռնվեցին Supabase-ից։ Ցանկը չի փոխարինվել տեղային օրինակով։",
    });
  }
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

function seedCatalog(id: string): CatalogTour | null {
  const base = getTourById(id);
  if (!base) return null;
  return {
    ...base,
    panoramaUrl: base.panoramaUrl ?? "",
    guideId: LOCAL_STAFF_ID,
    driverId: LOCAL_DRIVER_ID,
  };
}

function sanitizeTour(value: unknown): ManagedTour | null {
  const raw = value && typeof value === "object" ? (value as { id?: unknown }) : null;
  const id = typeof raw?.id === "string" ? raw.id : "";
  return asManaged(normalizeCatalogTour(value, canUseLocalDevSeeds(), id ? seedCatalog(id) : null));
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
  return deserializeSiteSettings(value, defaultSettings);
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
  if (!canUseLocalDevSeeds()) return;
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
  const session = canUseLocalDevSeeds() ? readSession() : null;
  const users = canUseLocalDevSeeds() ? (stored?.users ?? seedUsers()) : [];
  if (isSupabaseConfigured) {
    state = {
      tours: [],
      settings: defaultSettings,
      users: [],
      session: null,
      catalogError: null,
      settingsError: null,
    };
    emit();
    void refreshLiveCatalog();
  } else if (stored || session) {
    state = {
      tours: stored?.tours ?? state.tours,
      settings: stored?.settings ?? state.settings,
      users,
      session: session?.role === "admin" ? session : null,
      catalogError: null,
      settingsError: null,
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
  const current = state.tours.find((tour) => tour.id === id);
  if (current) return current;
  if (isSupabaseConfigured) return null;
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

function tourWritePayload(tour: ManagedTour): Database["public"]["Tables"]["tours"]["Insert"] {
  const row = serializeTourCatalog(tour);
  return {
    id: row.id,
    title: row.title,
    title_hy: row.title_hy,
    title_en: row.title_en,
    title_ru: row.title_ru,
    description_hy: row.description_hy,
    description_en: row.description_en,
    description_ru: row.description_ru,
    location_hy: row.location_hy,
    location_en: row.location_en,
    location_ru: row.location_ru,
    summary: row.summary,
    region: row.region,
    price: row.price,
    image_url: row.image_url,
    category: row.category,
    type: row.type,
    day: row.day,
    departure_place: row.departure_place,
    departure_time: row.departure_time,
    return_time: row.return_time,
    old_price: row.old_price,
    rating: row.rating,
    reviews: row.reviews,
    has360: row.has360,
    has_audio_guide: row.has_audio_guide,
    highlights: row.highlights,
    itinerary: row.itinerary,
    included: row.included,
    excluded: row.excluded,
    audio_chapters: row.audio_chapters,
    hotspots: row.hotspots,
    panorama_url: row.panorama_url,
    virtual_tour_url: row.virtual_tour_url,
    is_virtual_only: false,
    virtual_tour_id: row.virtual_tour_id,
    seats: row.seats,
  };
}

function commitSavedTour(saved: ManagedTour) {
  const replaced = state.tours.some((item) => item.id === saved.id)
    ? state.tours.map((item) => (item.id === saved.id ? saved : item))
    : [...state.tours, saved];
  const toursNext = saved.is_virtual_only
    ? replaced
    : replaced.map((item) => (item.id !== saved.id && item.virtual_tour_id === saved.id ? { ...item, virtual_tour_id: null } : item));
  setState({ tours: clearBrokenLinks(toursNext), catalogError: null });
  if (saved.is_virtual_only) removePortalTour(saved.id);
  else syncPortal(saved);
}

async function pushVirtualRecord(tour: ManagedTour) {
  if (!supabase || tour.is_virtual_only !== true) return;
  const { error } = await supabase.from("virtual_tours").upsert(serializeVirtualTour(tour));
  if (error) throwRemote("virtual_tours.upsert", "Վիրտուալ տուրը Supabase-ում չպահպանվեց։", error);
}

async function pushTour(tour: ManagedTour) {
  if (!supabase) return;
  if (tour.is_virtual_only) {
    await pushVirtualRecord(tour);
    const { error: leftoverError } = await supabase.from("tours").delete().eq("id", tour.id);
    if (leftoverError) throwRemote("tours.delete leftover", "Վիրտուալ տուրը պահվեց, բայց կատալոգի կրկնօրինակը չհեռացվեց։", leftoverError);
    return;
  }
  const { error } = await supabase.from("tours").upsert(tourWritePayload(tour));
  if (error) throwRemote("tours.upsert", "Տուրը Supabase-ում չպահպանվեց։", error);
  const { error: dropError } = await supabase.from("virtual_tours").delete().eq("id", tour.id);
  if (dropError) throwRemote("virtual_tours.delete leftover", "Տուրը պահվեց, բայց նույն համարի վիրտուալ կրկնօրինակը չհեռացվեց։", dropError);
}

export async function saveTour(tour: ManagedTour) {
  const saved: ManagedTour = tour.is_virtual_only ? { ...tour, virtual_tour_id: null } : tour;
  if (supabase) {
    await pushTour(saved);
    if (!remoteWriteCommitsLocally(true)) return;
    commitSavedTour(saved);
    return;
  }
  commitSavedTour(saved);
}

export async function deleteTour(tourId: string) {
  const existing = state.tours.find((tour) => tour.id === tourId);
  const remaining = state.tours
    .filter((tour) => tour.id !== tourId)
    .map((tour) => (tour.virtual_tour_id === tourId ? { ...tour, virtual_tour_id: null } : tour));
  if (supabase) {
    if (existing?.is_virtual_only === true) {
      const { error: virtualError } = await supabase.from("virtual_tours").delete().eq("id", tourId);
      if (virtualError) throwRemote("virtual_tours.delete", "Վիրտուալ տուրը Supabase-ից չջնջվեց։", virtualError);
      const { error: leftoverError } = await supabase.from("tours").delete().eq("id", tourId);
      if (leftoverError) throwRemote("tours.delete leftover", "Վիրտուալ տուրը ջնջվեց, բայց կատալոգի կրկնօրինակը մնաց։", leftoverError);
    } else {
      const { error } = await supabase.from("tours").delete().eq("id", tourId);
      if (error) throwRemote("tours.delete", "Տուրը Supabase-ից չջնջվեց։", error);
      const { error: leftoverVirtual } = await supabase.from("virtual_tours").delete().eq("id", tourId);
      if (leftoverVirtual) throwRemote("virtual_tours.delete leftover", "Տուրը ջնջվեց, բայց նույն համարի վիրտուալ գրառումը մնաց։", leftoverVirtual);
    }
  }
  setState({ tours: remaining });
  removePortalTour(tourId);
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
  if (supabase) {
    const { error } = await supabase.from("site_settings").upsert(serializeSiteSettings(next));
    if (error) throwRemote("site_settings.upsert", "Կարգավորումները Supabase-ում չպահպանվեցին։", error);
  }
  const toursNext = state.tours.map((tour) =>
    tour.is_virtual_only === true ? tour : { ...tour, departurePlace: next.departurePlace },
  );
  setState({ settings: next, tours: toursNext, settingsError: null });
  toursNext.forEach((tour) => {
    if (tour.is_virtual_only !== true) syncPortal(tour);
  });
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
  if (state.session?.role === "admin") {
    const users = await loadDirectory();
    return users.filter((user): user is StaffMember => user.role === "guide" || user.role === "driver");
  }
  const users = await loadCatalogStaff();
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
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password: input.password,
      options: {
        data: { full_name: fullName, role: "tourist", phone, birth_date: birthDate },
      },
    });
    if (error) throw new Error(error.message);
    if (data.user && data.user.identities && data.user.identities.length === 0) {
      throw new Error("Այս էլ. փոստով հաշիվ արդեն կա։");
    }
    if (!data.session?.access_token) {
      throw new Error("Հաշիվը ստեղծվեց։ Ստուգեք էլ. փոստը՝ գրանցումը հաստատելու համար։");
    }
    if (!data.user) throw new Error("Գրանցումը չհաջողվեց։");
    const account: DirectoryUser = {
      id: data.user.id,
      fullName,
      phone,
      email,
      password: "",
      role: "tourist",
      avatarUrl: "",
      bio: "",
      birthDate,
      createdAt: new Date().toISOString(),
    };
    return openAccountSession(account, data.session.access_token);
  }
  if (!canUseLocalDevSeeds()) throw new Error("Supabase-ը կարգավորված չէ։");
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
  return openAccountSession(account, crypto.randomUUID());
}

export async function signInTourist(identifier: string, password: string) {
  hydrateAdmin();
  const raw = identifier.trim();
  const byEmail = raw.includes("@");
  const digits = raw.replace(/\D/g, "");
  if (isSupabaseConfigured && supabase) {
    if (!byEmail) throw new Error("Մուտք գործեք էլ. փոստով։");
    const { data, error } = await supabase.auth.signInWithPassword({ email: raw.toLowerCase(), password });
    if (error || !data.user || !data.session) throw new Error("Էլ. փոստը, հեռախոսը կամ գաղտնաբառը սխալ է։");
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, full_name, phone, email, role")
      .eq("id", data.user.id)
      .maybeSingle();
    if (profileError || !profile) {
      await supabase.auth.signOut();
      throw new Error("Էլ. փոստը, հեռախոսը կամ գաղտնաբառը սխալ է։");
    }
    if (profile.role !== "tourist" && profile.role !== "guide" && profile.role !== "driver") {
      await supabase.auth.signOut();
      throw new Error("Այս հաշիվով մուտքը այստեղ հասանելի չէ։");
    }
    const account: DirectoryUser = {
      id: profile.id,
      fullName: profile.full_name,
      phone: profile.phone ?? "",
      email: profile.email ?? raw.toLowerCase(),
      password: "",
      role: profile.role,
      avatarUrl: "",
      bio: "",
      birthDate: "",
    };
    if (account.role === "guide") {
      openGuideSession({
        id: account.id,
        fullName: account.fullName,
        phone: account.phone,
        email: account.email,
        role: "guide",
      });
    } else {
      clearGuideProfile();
    }
    return openAccountSession(account, data.session.access_token);
  }
  if (!canUseLocalDevSeeds()) throw new Error("Supabase-ը կարգավորված չէ։");
  refreshStoredDirectory();
  const user = state.users.find((item) => {
    if (!item.password || item.password !== password) return false;
    if (byEmail) return item.email.trim().toLowerCase() === raw.toLowerCase();
    return digits.length >= 8 && item.phone.replace(/\D/g, "") === digits;
  });
  if (!user) throw new Error("Էլ. փոստը, հեռախոսը կամ գաղտնաբառը սխալ է։");
  if (user.role !== "tourist" && user.role !== "guide" && user.role !== "driver") {
    throw new Error("Այս հաշիվով մուտքը այստեղ հասանելի չէ։");
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
  return openAccountSession(user, crypto.randomUUID());
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
  const key = email.trim().toLowerCase();
  if (isSupabaseConfigured && supabase) {
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
  if (!canUseLocalDevSeeds()) throw new Error("Supabase-ը կարգավորված չէ։");
  refreshStoredDirectory();
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

const ADMIN_CREDENTIALS_ERROR = "Էլ. փոստը կամ գաղտնաբառը սխալ է։";
const ADMIN_UNAVAILABLE_ERROR = "Supabase-ը կարգավորված չէ։";

function localDevAdminSession(): AdminSession {
  const session: AdminSession = {
    id: "local-admin",
    fullName: "Ադմինիստրատոր",
    email: "dev-admin@localhost",
    role: "admin",
  };
  setState({ session });
  return session;
}

function canUseLocalDevAdmin() {
  return canUseLocalDevSeeds();
}

export async function signInAdmin(email: string, password: string) {
  const trimmed = email.trim().toLowerCase();
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.auth.signInWithPassword({ email: trimmed, password });
    if (error || !data.user) {
      throw new Error(ADMIN_CREDENTIALS_ERROR);
    }
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
  if (!canUseLocalDevAdmin()) throw new Error(ADMIN_UNAVAILABLE_ERROR);
  return localDevAdminSession();
}

export function signInMockAdmin() {
  if (!canUseLocalDevAdmin()) throw new Error(ADMIN_UNAVAILABLE_ERROR);
  return localDevAdminSession();
}

export async function signOutAdmin() {
  setState({ session: null });
  if (supabase) await supabase.auth.signOut();
}

export async function restoreAdminSession() {
  hydrateAdmin();
  if (!supabase) {
    if (!canUseLocalDevAdmin()) {
      setState({ session: null });
      return null;
    }
    return state.session;
  }
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
