import { tours } from "@/data/tours";
import type {
  AttendanceStatus,
  BookingStatus,
  PaymentProviderName,
  PaymentState,
  TourStatus,
} from "@/lib/database.types";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

export type { TourStatus };

export type StaffProfile = {
  id: string;
  fullName: string;
  phone: string;
  email: string;
  role: "guide";
};

export type AssignedTour = {
  id: string;
  title: string;
  departurePlace: string;
  departureTime: string;
  departureDate: string;
  status: TourStatus;
  guideId: string | null;
  driverId: string | null;
};

export type BookingRecord = {
  id: string;
  tourId: string;
  passengerName: string;
  phone: string;
  seatNumber: number;
  ticketCode: string;
  status: BookingStatus;
  adults: number;
  children: number;
  paymentProvider: PaymentProviderName | null;
  paymentStatus: PaymentState | null;
  amount: number;
  attendance: AttendanceStatus | null;
};

export type TourPhoto = {
  id: string;
  tourId: string;
  url: string;
  createdAt: string;
};

export type CheckInResult =
  | { ok: true; booking: BookingRecord; message: string }
  | { ok: false; message: string };

type PortalState = {
  profile: StaffProfile | null;
  tours: AssignedTour[];
  bookings: BookingRecord[];
  photos: TourPhoto[];
};

export const LOCAL_STAFF_ID = "local-staff";
export const LOCAL_DRIVER_ID = "local-driver-armen";
const SESSION_KEY = "ari-gnank-guide-session";
const GUIDE_LOCAL_KEY = "ari-gnank-guide-session";
const DATA_KEY = "ari-gnank-guide-data";

function upcomingDate(day: "saturday" | "sunday") {
  const now = new Date();
  const target = day === "saturday" ? 6 : 0;
  const date = new Date(now);
  date.setDate(now.getDate() + ((target - now.getDay() + 7) % 7 || 7));
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const dayOfMonth = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${dayOfMonth}`;
}

function seedTours(): AssignedTour[] {
  return tours.map((tour) => ({
    id: tour.id,
    title: tour.title_hy,
    departurePlace: tour.departurePlace,
    departureTime: tour.departureTime,
    departureDate: upcomingDate(tour.day),
    status: "scheduled",
    guideId: LOCAL_STAFF_ID,
    driverId: LOCAL_DRIVER_ID,
  }));
}

export function upcomingDepartureDate(day: "saturday" | "sunday") {
  return upcomingDate(day);
}

function seedBookings(): BookingRecord[] {
  return [
    {
      id: "local-b1",
      tourId: "garni",
      passengerName: "Անի Հակոբյան",
      phone: "+37491111222",
      seatNumber: 1,
      ticketCode: "AG-GAR-100001",
      status: "booked",
      adults: 1,
      children: 0,
      paymentProvider: "idram",
      paymentStatus: "SUCCESS",
      amount: 12000,
      attendance: null,
    },
    {
      id: "local-b2",
      tourId: "garni",
      passengerName: "Դավիթ Պետրոսյան",
      phone: "+37493123456",
      seatNumber: 2,
      ticketCode: "AG-GAR-100002",
      status: "booked",
      adults: 2,
      children: 1,
      paymentProvider: "telcell",
      paymentStatus: "PENDING",
      amount: 36000,
      attendance: null,
    },
  ];
}

function normalizeTour(tour: AssignedTour): AssignedTour {
  const guideId = typeof tour.guideId === "string" || tour.guideId === null ? tour.guideId : LOCAL_STAFF_ID;
  const driverId = typeof tour.driverId === "string" || tour.driverId === null ? tour.driverId : LOCAL_DRIVER_ID;
  return { ...tour, guideId, driverId };
}

function paymentProviderOf(value: unknown): PaymentProviderName | null {
  return value === "idram" || value === "telcell" || value === "arca" ? value : null;
}

function paymentStatusOf(value: unknown): PaymentState | null {
  return value === "SUCCESS" || value === "FAILED" || value === "PENDING" ? value : null;
}

function attendanceOf(value: unknown): AttendanceStatus | null {
  return value === "present" || value === "absent" ? value : null;
}

function normalizeBooking(booking: BookingRecord): BookingRecord {
  const paymentProvider = paymentProviderOf(booking.paymentProvider);
  const paymentStatus = paymentStatusOf(booking.paymentStatus);
  const amount = typeof booking.amount === "number" ? booking.amount : 0;
  const attendance = attendanceOf(booking.attendance);
  if (booking.id === "local-b1" && paymentProvider === null && amount === 0) {
    return { ...booking, paymentProvider: "idram", paymentStatus: "SUCCESS", amount: 12000, attendance };
  }
  if (booking.id === "local-b2" && paymentProvider === null && amount === 0) {
    return { ...booking, paymentProvider: "telcell", paymentStatus: "PENDING", amount: 36000, attendance };
  }
  return { ...booking, paymentProvider, paymentStatus, amount, attendance };
}

function readSavedData(): Pick<PortalState, "tours" | "bookings" | "photos"> | null {
  if (typeof sessionStorage === "undefined" || isSupabaseConfigured) return null;
  const raw = sessionStorage.getItem(DATA_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Pick<PortalState, "tours" | "bookings" | "photos">;
    if (!Array.isArray(parsed.tours) || !Array.isArray(parsed.bookings)) return null;
    return {
      tours: parsed.tours.map(normalizeTour),
      bookings: parsed.bookings.map(normalizeBooking),
      photos: parsed.photos,
    };
  } catch {
    return null;
  }
}

let state: PortalState = (() => {
  const saved = readSavedData();
  return {
    profile: null,
    tours: saved?.tours?.length ? saved.tours : seedTours(),
    bookings: saved?.bookings ?? seedBookings(),
    photos: saved?.photos ?? [],
  };
})();

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function setState(patch: Partial<PortalState>) {
  state = { ...state, ...patch };
  if (!isSupabaseConfigured && typeof sessionStorage !== "undefined") {
    try {
      sessionStorage.setItem(
        DATA_KEY,
        JSON.stringify({ tours: state.tours, bookings: state.bookings, photos: state.photos }),
      );
    } catch {
      /* A large photo can exceed session storage. The in-memory album still shows. */
    }
  }
  emit();
}

export function subscribePortal(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPortalSnapshot() {
  return state;
}

const serverSnapshot: PortalState = {
  profile: null,
  tours: [],
  bookings: [],
  photos: [],
};

export function getPortalServerSnapshot() {
  return serverSnapshot;
}

function parseGuideProfile(raw: string | null): StaffProfile | null {
  if (!raw) return null;
  try {
    const profile = JSON.parse(raw) as StaffProfile;
    if (profile.role !== "guide" || typeof profile.id !== "string" || typeof profile.fullName !== "string") return null;
    return profile;
  } catch {
    return null;
  }
}

function readStoredProfile(): StaffProfile | null {
  const local = typeof localStorage === "undefined" ? null : parseGuideProfile(localStorage.getItem(GUIDE_LOCAL_KEY));
  if (local) return local;
  if (typeof sessionStorage === "undefined") return null;
  return parseGuideProfile(sessionStorage.getItem(SESSION_KEY));
}

function storeProfile(profile: StaffProfile | null) {
  if (typeof localStorage !== "undefined") {
    if (!profile) localStorage.removeItem(GUIDE_LOCAL_KEY);
    else localStorage.setItem(GUIDE_LOCAL_KEY, JSON.stringify(profile));
  }
  if (typeof sessionStorage === "undefined") return;
  if (!profile) sessionStorage.removeItem(SESSION_KEY);
  else sessionStorage.setItem(SESSION_KEY, JSON.stringify(profile));
}

export function clearGuideProfile() {
  storeProfile(null);
  setState({ profile: null });
}

export function ticketCodeFromScan(raw: string) {
  const match = raw.toUpperCase().match(/AG-[A-Z0-9]+-\d+/);
  return (match?.[0] ?? raw).trim().toUpperCase();
}

async function requireStaffProfile(userId: string): Promise<StaffProfile> {
  if (!supabase) throw new Error("Supabase-ը միացված չէ։");
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, phone, email, role")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data || data.role !== "guide") {
    await supabase.auth.signOut();
    throw new Error("Այս հաշիվը զբոսավար չէ։");
  }
  return {
    id: data.id,
    fullName: data.full_name,
    phone: data.phone ?? "",
    email: data.email ?? "",
    role: "guide",
  };
}

export function openGuideSession(profile: StaffProfile) {
  storeProfile(profile);
  setState({ profile });
}

export async function restoreGuideSession() {
  if (!isSupabaseConfigured || !supabase) {
    const profile = readStoredProfile();
    if (profile) setState({ profile });
    return profile;
  }
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) {
    setState({ profile: null, tours: [], bookings: [], photos: [] });
    return null;
  }
  try {
    const profile = await requireStaffProfile(userId);
    const assigned = await listAssignedTours(profile.id);
    setState({ profile, tours: assigned });
    return profile;
  } catch (error) {
    setState({ profile: null, tours: [], bookings: [], photos: [] });
    throw error;
  }
}

export async function signOutGuide() {
  storeProfile(null);
  if (supabase) await supabase.auth.signOut();
  setState({
    profile: null,
    tours: isSupabaseConfigured ? [] : seedTours(),
    bookings: isSupabaseConfigured ? [] : seedBookings(),
    photos: [],
  });
}

export async function listAssignedTours(userId: string): Promise<AssignedTour[]> {
  if (!supabase) {
    return state.tours.filter((tour) => tour.guideId === userId);
  }
  const { data, error } = await supabase
    .from("tours")
    .select("id, title_hy, departure_place, departure_time, departure_date, status, guide_id, driver_id")
    .eq("guide_id", userId)
    .order("departure_date");
  if (error) throw new Error("Տուրերի ցանկը չբեռնվեց։");
  return data.map((row) => ({
    id: row.id,
    title: row.title_hy,
    departurePlace: row.departure_place ?? "",
    departureTime: row.departure_time ?? "",
    departureDate: row.departure_date ?? "",
    status: row.status ?? "scheduled",
    guideId: row.guide_id,
    driverId: row.driver_id,
  }));
}

export function assignPortalStaff(tourId: string, guideId: string | null, driverId: string | null) {
  if (!state.tours.some((tour) => tour.id === tourId)) return;
  setState({
    tours: state.tours.map((tour) => (tour.id === tourId ? { ...tour, guideId, driverId } : tour)),
  });
}

export function upsertPortalTour(input: {
  id: string;
  title: string;
  departurePlace: string;
  departureTime: string;
  departureDate: string;
  guideId: string | null;
  driverId: string | null;
}) {
  const existing = state.tours.find((tour) => tour.id === input.id);
  const next: AssignedTour = {
    id: input.id,
    title: input.title,
    departurePlace: input.departurePlace,
    departureTime: input.departureTime,
    departureDate: input.departureDate,
    status: existing?.status ?? "scheduled",
    guideId: input.guideId,
    driverId: input.driverId,
  };
  setState({
    tours: existing
      ? state.tours.map((tour) => (tour.id === input.id ? next : tour))
      : [...state.tours, next],
  });
}

export function removePortalTour(tourId: string) {
  setState({ tours: state.tours.filter((tour) => tour.id !== tourId) });
}

export async function setAttendance(bookingId: string, attendance: AttendanceStatus | null) {
  const current = state.bookings.find((booking) => booking.id === bookingId);
  if (!current) throw new Error("Ուղևորը չի գտնվել։");
  setState({
    bookings: state.bookings.map((booking) => (booking.id === bookingId ? { ...booking, attendance } : booking)),
  });
  if (!supabase) return;
  const { error } = await supabase.from("bookings").update({ attendance: attendance ?? "pending" }).eq("id", bookingId);
  if (error) throw new Error("Ներկայությունը չպահվեց։ Տեղային վիճակը թարմացվեց։");
}

export async function listBookings(tourId: string): Promise<BookingRecord[]> {
  if (!supabase) {
    return state.bookings
      .filter((booking) => booking.tourId === tourId)
      .slice()
      .sort((a, b) => a.seatNumber - b.seatNumber);
  }
  const { data, error } = await supabase
    .from("bookings")
    .select(
      "id, tour_id, passenger_name, phone, seat_number, ticket_code, status, adults, children, payment_provider, payment_status, amount, attendance",
    )
    .eq("tour_id", tourId)
    .order("seat_number");
  if (error) throw new Error("Ուղևորացուցակը չբեռնվեց։");
  return data.map(mapBooking);
}

export async function loadTourManifest(tourId: string, departureDate = "") {
  const byTour = await listBookings(tourId);
  const sameDepartureIds = departureDate
    ? state.tours.filter((tour) => tour.id === tourId && tour.departureDate === departureDate).map((tour) => tour.id)
    : [];
  const relatedIds = new Set([tourId, ...sameDepartureIds]);
  const localMatches = state.bookings.filter((booking) => relatedIds.has(booking.tourId));
  const merged = new Map<string, BookingRecord>();
  for (const booking of [...localMatches, ...byTour]) merged.set(booking.id, booking);
  const manifest = [...merged.values()].sort((a, b) => a.seatNumber - b.seatNumber);
  const rest = state.bookings.filter((booking) => !relatedIds.has(booking.tourId));
  setState({ bookings: [...rest, ...manifest] });
  return manifest;
}

export async function listPhotos(tourId: string): Promise<TourPhoto[]> {
  if (!supabase) return state.photos.filter((photo) => photo.tourId === tourId);
  const { data, error } = await supabase
    .from("tour_photos")
    .select("id, tour_id, url, created_at")
    .eq("tour_id", tourId)
    .order("created_at");
  if (error) throw new Error("Լուսանկարները չբեռնվեցին։");
  return data.map((row) => ({
    id: row.id,
    tourId: row.tour_id,
    url: row.url,
    createdAt: row.created_at,
  }));
}

function mapBooking(row: {
  id: string;
  tour_id?: string | null;
  passenger_name?: string | null;
  phone?: string | null;
  seat_number?: number;
  ticket_code?: string | null;
  status: BookingStatus;
  adults?: number;
  children?: number;
  payment_provider?: string | null;
  payment_status?: string | null;
  amount?: number | null;
  total_price?: number | null;
  attendance?: string | null;
}): BookingRecord {
  return {
    id: row.id,
    tourId: row.tour_id ?? "",
    passengerName: row.passenger_name ?? "",
    phone: row.phone ?? "",
    seatNumber: row.seat_number ?? 1,
    ticketCode: row.ticket_code ?? "",
    status: row.status,
    adults: row.adults ?? 1,
    children: row.children ?? 0,
    paymentProvider: paymentProviderOf(row.payment_provider),
    paymentStatus: paymentStatusOf(row.payment_status),
    amount: row.amount ?? row.total_price ?? 0,
    attendance: attendanceOf(row.attendance),
  };
}

function nextSeat(tourId: string) {
  const taken = state.bookings.filter((booking) => booking.tourId === tourId);
  return taken.reduce((max, booking) => Math.max(max, booking.seatNumber), 0) + 1;
}

export function peekNextSeat(tourId: string) {
  return nextSeat(tourId);
}

export async function registerBooking(input: {
  tourId: string;
  passengerName: string;
  phone: string;
  adults: number;
  children: number;
  ticketCode: string;
  paymentProvider?: PaymentProviderName | null;
  paymentStatus?: PaymentState | null;
  amount?: number;
}) {
  if (!supabase) {
    const existing = state.bookings.find(
      (item) => item.ticketCode.toUpperCase() === input.ticketCode.toUpperCase(),
    );
    if (existing) return existing;
    const booking: BookingRecord = {
      id: crypto.randomUUID(),
      tourId: input.tourId,
      passengerName: input.passengerName,
      phone: input.phone,
      seatNumber: nextSeat(input.tourId),
      ticketCode: input.ticketCode,
      status: "booked",
      adults: input.adults,
      children: input.children,
      paymentProvider: input.paymentProvider ?? null,
      paymentStatus: input.paymentStatus ?? null,
      amount: input.amount ?? 0,
      attendance: null,
    };
    setState({ bookings: [...state.bookings, booking] });
    return booking;
  }

  const { data, error } = await supabase.rpc("create_booking", {
    p_tour_id: input.tourId,
    p_passenger_name: input.passengerName,
    p_phone: input.phone,
    p_ticket_code: input.ticketCode,
    p_adults: input.adults,
    p_children: input.children,
  });
  if (error || !data) throw new Error("Ամրագրումը չպահպանվեց։");
  if (input.paymentProvider && input.paymentStatus) {
    await supabase.rpc("set_booking_payment", {
      p_ticket_code: input.ticketCode,
      p_provider: input.paymentProvider,
      p_status: input.paymentStatus,
      p_amount: input.amount ?? 0,
    });
  }
  return mapBooking({
    ...data,
    payment_provider: input.paymentProvider ?? data.payment_provider,
    payment_status: input.paymentStatus ?? data.payment_status,
    amount: input.amount ?? data.amount,
  });
}

export async function checkInPassenger(tourId: string, rawCode: string): Promise<CheckInResult> {
  const ticketCode = ticketCodeFromScan(rawCode);
  if (!ticketCode) return { ok: false, message: "QR կոդը դատարկ է։" };

  if (!supabase) {
    const booking = state.bookings.find(
      (item) => item.tourId === tourId && item.ticketCode.toUpperCase() === ticketCode,
    );
    if (!booking) return { ok: false, message: "Այս տուրում այդպիսի տոմս չկա։" };
    if (booking.status === "checked_in") {
      return { ok: false, message: `${booking.passengerName} արդեն գրանցված է։` };
    }
    const updated: BookingRecord = { ...booking, status: "checked_in" };
    setState({
      bookings: state.bookings.map((item) => (item.id === booking.id ? updated : item)),
    });
    return { ok: true, booking: updated, message: `${updated.passengerName} գրանցվեց։` };
  }

  const { data, error } = await supabase
    .from("bookings")
    .select(
      "id, tour_id, passenger_name, phone, seat_number, ticket_code, status, adults, children, checked_in_at",
    )
    .eq("tour_id", tourId)
    .eq("ticket_code", ticketCode)
    .maybeSingle();
  if (error) return { ok: false, message: "Գրանցումը չստուգվեց։" };
  if (!data) return { ok: false, message: "Այս տուրում այդպիսի տոմս չկա։" };
  if (data.status === "checked_in") {
    return { ok: false, message: `${data.passenger_name} արդեն գրանցված է։` };
  }
  const { data: saved, error: updateError } = await supabase
    .from("bookings")
    .update({ status: "checked_in", checked_in_at: new Date().toISOString() })
    .eq("id", data.id)
    .select(
      "id, tour_id, passenger_name, phone, seat_number, ticket_code, status, adults, children, checked_in_at",
    )
    .single();
  if (updateError || !saved) return { ok: false, message: "Գրանցումը չպահպանվեց։" };
  const booking = mapBooking(saved);
  return { ok: true, booking, message: `${booking.passengerName} գրանցվեց։` };
}

export async function updateTourStatus(tourId: string, status: TourStatus) {
  if (!supabase) {
    setState({
      tours: state.tours.map((tour) => (tour.id === tourId ? { ...tour, status } : tour)),
    });
    return;
  }
  const { error } = await supabase.from("tours").update({ status }).eq("id", tourId);
  if (error) throw new Error("Տուրի կարգավիճակը չփոխվեց։");
  if (state.profile) {
    setState({ tours: await listAssignedTours(state.profile.id) });
  }
}

export async function uploadTourPhotos(tourId: string, files: File[], userId: string) {
  const images = files.filter((file) => file.type.startsWith("image/"));
  if (images.length === 0) throw new Error("Ընտրեք լուսանկար։");

  if (!supabase) {
    const photos = await Promise.all(images.map((file) => readLocalPhoto(file, tourId)));
    setState({ photos: [...state.photos, ...photos] });
    return photos;
  }

  const uploaded: TourPhoto[] = [];
  for (const file of images) {
    const path = `${tourId}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]+/g, "_")}`;
    const { error: uploadError } = await supabase.storage.from("tour-albums").upload(path, file, {
      contentType: file.type,
      upsert: false,
    });
    if (uploadError) throw new Error("Լուսանկարը չվերբեռնվեց։");
    const { data: publicUrl } = supabase.storage.from("tour-albums").getPublicUrl(path);
    const { data, error } = await supabase
      .from("tour_photos")
      .insert({ tour_id: tourId, url: publicUrl.publicUrl, uploaded_by: userId })
      .select("id, tour_id, url, created_at")
      .single();
    if (error || !data) throw new Error("Լուսանկարը չպահպանվեց։");
    uploaded.push({
      id: data.id,
      tourId: data.tour_id,
      url: data.url,
      createdAt: data.created_at,
    });
  }
  return uploaded;
}

function readLocalPhoto(file: File, tourId: string) {
  return new Promise<TourPhoto>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve({
        id: crypto.randomUUID(),
        tourId,
        url: String(reader.result),
        createdAt: new Date().toISOString(),
      });
    reader.onerror = () => reject(new Error("Լուսանկարը չկարդացվեց։"));
    reader.readAsDataURL(file);
  });
}
