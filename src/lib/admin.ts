import garniPhoto from "@/assets/tour-garni.jpg";
import sevanPhoto from "@/assets/tour-sevan.jpg";
import tatevPhoto from "@/assets/tour-tatev.jpg";
import { getTourById, tours, type Tour } from "@/data/tours";
import type { PaymentProviderName, PaymentState, UserRole } from "@/lib/database.types";
import {
  getPortalSnapshot,
  LOCAL_DRIVER_ID,
  LOCAL_STAFF_ID,
  clearGuideProfile,
  listAssignedDepartures,
  openGuideSession,
  removePortalTour,
  replaceAssignedTours,
  upcomingDepartureDate,
  upsertPortalTour,
  type BookingRecord,
} from "@/lib/guide-api";
import { assigneeRoleError, isExplicitDepartureDate } from "@/lib/departure-assignment";
import { loadPublicStaff, type PublicStaffMember } from "@/lib/crew";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import {
  createSupabaseCatalogRemote,
  loadRemoteCatalog,
  persistCatalogSettings,
  persistCatalogTour,
  removeCatalogTour,
  type CatalogRemote,
} from "@/lib/catalog-persistence";
import { assignedWeekendDay } from "@/lib/calendar-date";
import {
  deserializeSiteSettings,
  logRemoteError,
  normalizeCatalogTour,
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

export type CatalogStatus = "idle" | "loading" | "loaded" | "error";

export function catalogIsPending(status: CatalogStatus) {
  return status === "idle" || status === "loading";
}

type AdminState = {
  tours: ManagedTour[];
  settings: SiteSettings;
  users: DirectoryUser[];
  session: AdminSession | null;
  catalogStatus: CatalogStatus;
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
  catalogStatus: canUseLocalDevSeeds() ? "loaded" : "idle",
  catalogError: null,
  settingsError: null,
};

let state: AdminState = serverSnapshot;
let tourist: TouristSession | null = null;
let hydrated = false;
let accountStatus: "checking" | "ready" = "ready";
let accountRestore: Promise<void> | null = null;
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

function catalogRemote(): CatalogRemote | null {
  if (!supabase) return null;
  return createSupabaseCatalogRemote(supabase as never);
}

async function refreshLiveCatalog() {
  const remote = catalogRemote();
  if (!isSupabaseConfigured || !remote) return;
  const request = ++liveCatalogRequest;
  try {
    const [outcome, staff] = await Promise.all([loadRemoteCatalog(remote, defaultSettings), loadCatalogStaff()]);
    if (request !== liveCatalogRequest) return;
    if (outcome.status === "error") {
      setState({
        users: staff,
        catalogStatus: "error",
        catalogError: outcome.message,
      });
      return;
    }
    const next = clearBrokenLinks(outcome.tours.map((tour) => asManaged(tour)).filter((tour): tour is ManagedTour => tour !== null));
    setState({
      tours: next,
      users: staff,
      settings: outcome.settings,
      catalogStatus: "loaded",
      catalogError: null,
      settingsError: outcome.settingsError,
    });
    next.forEach((tour) => {
      if (tour.is_virtual_only !== true) syncPortal(tour);
    });
  } catch (error) {
    if (request !== liveCatalogRequest) return;
    logRemoteError("catalog.refresh", error);
    setState({
      catalogStatus: "error",
      catalogError: "Տուրերը չբեռնվեցին Supabase-ից։ Ցանկը չի փոխարինվել տեղային օրինակով։",
    });
  }
}

export async function retryLiveCatalog() {
  if (!isSupabaseConfigured) return;
  setState({ catalogStatus: "loading", catalogError: null });
  await refreshLiveCatalog();
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

export function getAccountStatus() {
  return accountStatus;
}

export function signOutTourist() {
  tourist = null;
  accountStatus = "ready";
  if (typeof localStorage !== "undefined") localStorage.removeItem(TOURIST_KEY);
  clearGuideProfile();
  replaceAssignedTours([]);
  setState({ session: null });
  emitTourist();
  if (supabase) void supabase.auth.signOut();
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
      catalogStatus: "loading",
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
      catalogStatus: "loaded",
      catalogError: null,
      settingsError: null,
    };
    emit();
  } else {
    state = { ...state, catalogStatus: "loaded" };
    emit();
  }
  if (isSupabaseConfigured) {
    if (!accountRestore) {
      tourist = null;
      accountStatus = "checking";
      emitTourist();
    }
    void ensureAccountRestored();
    return;
  }
  const nextTourist = readTourist(state.users);
  if (!nextTourist && typeof localStorage !== "undefined" && localStorage.getItem(TOURIST_KEY)) {
    localStorage.removeItem(TOURIST_KEY);
  }
  tourist = nextTourist;
  accountStatus = "ready";
  emitTourist();
}

export function ensureAccountRestored() {
  if (!isSupabaseConfigured || !supabase) {
    accountStatus = "ready";
    emitTourist();
    return Promise.resolve();
  }
  if (!accountRestore) {
    accountStatus = "checking";
    emitTourist();
    accountRestore = restoreAccountFromAuth().finally(() => {
      accountStatus = "ready";
      emitTourist();
    });
  }
  return accountRestore;
}

async function restoreAccountFromAuth() {
  if (!supabase) return;
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  const userId = session?.user.id;
  if (!userId || !session) {
    tourist = null;
    if (typeof localStorage !== "undefined") localStorage.removeItem(TOURIST_KEY);
    clearGuideProfile();
    replaceAssignedTours([]);
    setState({ session: null });
    return;
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, phone, email, role, avatar_url, bio, birth_date")
    .eq("id", userId)
    .maybeSingle();
  if (!profile) {
    tourist = null;
    if (typeof localStorage !== "undefined") localStorage.removeItem(TOURIST_KEY);
    clearGuideProfile();
    setState({ session: null });
    return;
  }
  if (profile.role === "admin") {
    tourist = null;
    if (typeof localStorage !== "undefined") localStorage.removeItem(TOURIST_KEY);
    clearGuideProfile();
    replaceAssignedTours([]);
    setState({
      session: {
        id: profile.id,
        fullName: profile.full_name,
        email: profile.email ?? session.user.email ?? "",
        role: "admin",
      },
    });
    return;
  }
  if (profile.role !== "tourist" && profile.role !== "guide" && profile.role !== "driver") {
    tourist = null;
    clearGuideProfile();
    setState({ session: null });
    return;
  }
  const account = userFromRow(profile);
  setState({ session: null });
  openAccountSession(account, session.access_token);
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
  if (account.role === "guide" || account.role === "driver") {
    const assigned = await listAssignedDepartures(account.id, account.role);
    replaceAssignedTours(assigned);
  } else {
    replaceAssignedTours([]);
  }
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
  const weekend = assignedWeekendDay(tour.day);
  upsertPortalTour({
    id: tour.id,
    title: tour.title_hy,
    departurePlace: tour.departurePlace,
    departureTime: tour.departureTime,
    departureDate: weekend ? upcomingDepartureDate(weekend) : "",
    guideId: tour.guideId,
    driverId: tour.driverId,
  });
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

async function pushTour(tour: ManagedTour) {
  const remote = catalogRemote();
  if (!remote) return;
  await persistCatalogTour(remote, tour);
}

export async function saveTour(tour: ManagedTour) {
  const saved: ManagedTour = tour.is_virtual_only ? { ...tour, virtual_tour_id: null } : tour;
  const remote = catalogRemote();
  if (remote) await pushTour(saved);
  commitSavedTour(saved);
}

export async function deleteTour(tourId: string) {
  const existing = state.tours.find((tour) => tour.id === tourId);
  const remaining = state.tours
    .filter((tour) => tour.id !== tourId)
    .map((tour) => (tour.virtual_tour_id === tourId ? { ...tour, virtual_tour_id: null } : tour));
  const remote = catalogRemote();
  if (remote && existing) await removeCatalogTour(remote, existing);
  setState({ tours: remaining });
  removePortalTour(tourId);
}

export type CatalogDeparture = {
  id: string;
  tourId: string;
  departureDate: string;
  availableSeats: number;
  guideId: string | null;
  driverId: string | null;
};

async function requireAssignee(expected: "guide" | "driver", accountId: string | null) {
  if (!accountId) return;
  if (!supabase) {
    const role = state.users.find((user) => user.id === accountId)?.role ?? null;
    const message = assigneeRoleError(expected, role);
    if (message) throw new Error(message);
    return;
  }
  const { data, error } = await supabase.from("profiles").select("role").eq("id", accountId).maybeSingle();
  if (error || !data) throw new Error("Ընտրված հաշիվը չի գտնվել։");
  const message = assigneeRoleError(expected, data.role);
  if (message) throw new Error(message);
}

export async function loadDepartures(): Promise<CatalogDeparture[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("departures")
    .select("id, tour_id, departure_date, available_seats, guide_id, driver_id")
    .order("departure_date");
  if (error) throw new Error("Մեկնումները չբեռնվեցին։");
  return data.map((row) => ({
    id: row.id,
    tourId: row.tour_id,
    departureDate: row.departure_date,
    availableSeats: row.available_seats,
    guideId: row.guide_id,
    driverId: row.driver_id,
  }));
}

export async function loadAssignmentConflicts(): Promise<{ tourId: string; reason: string }[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("departure_assignment_conflicts")
    .select("tour_id, reason")
    .order("tour_id");
  if (error) throw new Error("Կոնֆլիկտները չբեռնվեցին։");
  return data.map((row) => ({ tourId: row.tour_id, reason: row.reason }));
}

export async function createDeparture(tourId: string, departureDate: string, seats: number) {
  if (!isExplicitDepartureDate(departureDate)) throw new Error("Նշեք մեկնման ամսաթիվը։");
  if (!supabase) throw new Error("Supabase-ը կարգավորված չէ։");
  const { data, error } = await supabase
    .from("departures")
    .insert({
      tour_id: tourId,
      departure_date: departureDate,
      available_seats: Math.max(0, Math.round(seats)),
    })
    .select("id, tour_id, departure_date, available_seats, guide_id, driver_id")
    .single();
  if (error || !data) throw new Error("Մեկնումը չպահպանվեց։");
  return {
    id: data.id,
    tourId: data.tour_id,
    departureDate: data.departure_date,
    availableSeats: data.available_seats,
    guideId: data.guide_id,
    driverId: data.driver_id,
  } satisfies CatalogDeparture;
}

export async function assignDepartureCrew(
  departureId: string,
  guideId: string | null,
  driverId: string | null,
) {
  await requireAssignee("guide", guideId);
  await requireAssignee("driver", driverId);
  if (!supabase) throw new Error("Supabase-ը կարգավորված չէ։");
  const { data, error } = await supabase
    .from("departures")
    .update({ guide_id: guideId, driver_id: driverId })
    .eq("id", departureId)
    .select("id");
  if (error || !data?.length) throw new Error("Նշանակումը չպահպանվեց։");
}

export async function saveSettings(settings: SiteSettings) {
  const next = {
    ...settings,
    cashbackPercent: Math.min(100, Math.max(0, Math.round(settings.cashbackPercent))),
  };
  const remote = catalogRemote();
  if (remote) await persistCatalogSettings(remote, next);
  setState({ settings: next, settingsError: null });
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
    password: isSupabaseConfigured ? "" : next.password,
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
    if (account.role === "guide" || account.role === "driver") {
      replaceAssignedTours(await listAssignedDepartures(account.id, account.role));
    } else {
      replaceAssignedTours([]);
    }
    setState({ session: null });
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
  if (isSupabaseConfigured && supabase) {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("Մուտքը չի հաստատվել։");
    const response = await fetch("/api/staff/accounts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        role: input.role,
        fullName: input.fullName,
        phone: input.phone,
        email: input.email,
        password: input.password,
        avatarUrl: input.avatarUrl,
        bio: input.bio,
      }),
    });
    const payload = (await response.json().catch(() => null)) as { error?: unknown; id?: unknown } | null;
    if (!response.ok || !payload || typeof payload.id !== "string") {
      throw new Error(typeof payload?.error === "string" ? payload.error : "Հաշիվը չստեղծվեց։");
    }
    const account: DirectoryUser = {
      id: payload.id,
      fullName: input.fullName.trim(),
      phone: input.phone.trim(),
      email: input.email.trim().toLowerCase(),
      password: "",
      role: input.role,
      avatarUrl: input.avatarUrl.trim(),
      bio: input.bio.trim(),
      birthDate: "",
    };
    setState({ users: [...state.users.filter((user) => user.id !== account.id), account] });
    return account;
  }
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
    replaceAssignedTours(await listAssignedDepartures(profile.id, "guide"));
    setState({ session: null });
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
      "id, tour_id, departure_id, passenger_name, phone, seat_number, ticket_code, status, adults, children, payment_provider, payment_status, amount, departures(departure_date)",
    )
    .order("seat_number");
  if (error) throw new Error("Ամրագրումները չբեռնվեցին։");
  return data.map((row) => {
    const booking = bookingFromRow(row);
    if (row.departure_id) booking.departureId = row.departure_id;
    const departure = row.departures;
    const departureDate = departure && !Array.isArray(departure) ? departure.departure_date : null;
    if (typeof departureDate === "string") booking.departureDate = departureDate;
    return booking;
  });
}

export async function loadBookingLinkConflicts() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("booking_departure_conflicts")
    .select("id, tour_id, ticket_code, reason")
    .order("id");
  if (error) throw new Error("Անորոշ ամրագրումները չբեռնվեցին։");
  return data;
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
    tourist = null;
    if (typeof localStorage !== "undefined") localStorage.removeItem(TOURIST_KEY);
    clearGuideProfile();
    replaceAssignedTours([]);
    setState({ session });
    emitTourist();
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
  signOutTourist();
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
  await ensureAccountRestored();
  return state.session?.role === "admin" ? state.session : null;
}
