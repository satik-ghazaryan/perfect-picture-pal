/** Finding a booking that was made without an account: the ticket code plus the phone it was booked with. */

export type LookupBookingRow = {
  ticketCode: string;
  passengerName: string;
  phone: string;
  tourId: string | null;
  departureId: string | null;
  seatNumber: number;
  adults: number;
  children: number;
  status: string;
  paymentStatus: string | null;
  amount: number;
};

export type LookupCrewMember = { fullName: string; avatarUrl: string };

export type GuestBooking = {
  ticketCode: string;
  passengerName: string;
  tourId: string | null;
  tourTitle: string;
  departureDate: string;
  departureTime: string;
  departurePlace: string;
  adults: number;
  children: number;
  seatNumbers: number[];
  status: string;
  paid: boolean;
  amount: number;
  /** False until the departure is one day away; the crew stays hidden until then. */
  crewRevealed: boolean;
  guide: LookupCrewMember | null;
  driver: LookupCrewMember | null;
};

export type LookupResult =
  | { ok: true; booking: GuestBooking }
  | { ok: false; code: "invalid" | "not_found" | "failed"; message: string };

const NOT_FOUND =
  "Այս կոդով և հեռախոսահամարով ամրագրում չի գտնվել։ Ստուգեք տոմսի կոդը և հեռախոսահամարը։";
const DAY_MS = 24 * 60 * 60 * 1000;

export function normalizeTicketCode(value: string) {
  const code = value.trim().toUpperCase().replace(/\s+/g, "");
  return /^AG-[A-Z0-9-]{4,24}$/.test(code) ? code : "";
}

/** The last eight digits identify an Armenian number however it was typed (+374 94…, 094…, 94…). */
export function phoneTail(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 8 ? digits.slice(-8) : "";
}

/** The moment the tour leaves, in Yerevan time (UTC+4, no daylight saving). */
export function departureInstant(date: string, time: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(time.trim());
  const hours = match ? match[1]!.padStart(2, "0") : "00";
  const minutes = match ? match[2]! : "00";
  const at = Date.parse(`${date}T${hours}:${minutes}:00+04:00`);
  return Number.isNaN(at) ? null : at;
}

export async function findGuestBooking(
  input: { ticketCode: string; phone: string },
  deps: {
    loadBookings: (ticketCode: string) => Promise<LookupBookingRow[]>;
    loadDeparture: (
      id: string,
    ) => Promise<{ departureDate: string; guideId: string | null; driverId: string | null } | null>;
    loadTour: (
      id: string,
    ) => Promise<{ title: string; departureTime: string; departurePlace: string } | null>;
    loadStaff: (id: string, role: "guide" | "driver") => Promise<LookupCrewMember | null>;
  },
  now = Date.now(),
): Promise<LookupResult> {
  const ticketCode = normalizeTicketCode(input.ticketCode);
  const tail = phoneTail(input.phone);
  if (!ticketCode) {
    return { ok: false, code: "invalid", message: "Գրեք տոմսի կոդը, օրինակ՝ AG-7933D3BB։" };
  }
  if (!tail) {
    return {
      ok: false,
      code: "invalid",
      message: "Գրեք այն հեռախոսահամարը, որով ամրագրել եք։",
    };
  }
  try {
    const rows = (await deps.loadBookings(ticketCode)).filter(
      (row) => row.ticketCode.toUpperCase() === ticketCode && phoneTail(row.phone) === tail,
    );
    const first = rows[0];
    // The same answer whether the code is unknown or the phone is wrong, so codes cannot be probed.
    if (!first) return { ok: false, code: "not_found", message: NOT_FOUND };
    const departure = first.departureId ? await deps.loadDeparture(first.departureId) : null;
    const tour = first.tourId ? await deps.loadTour(first.tourId) : null;
    const departureDate = departure?.departureDate ?? "";
    const departureTime = tour?.departureTime ?? "";
    const leavesAt = departureInstant(departureDate, departureTime);
    const crewRevealed = leavesAt !== null && leavesAt - now <= DAY_MS;
    const cancelled = rows.every((row) => row.status === "cancelled");
    const showCrew = crewRevealed && !cancelled && departure !== null;
    const guide =
      showCrew && departure.guideId ? await deps.loadStaff(departure.guideId, "guide") : null;
    const driver =
      showCrew && departure.driverId ? await deps.loadStaff(departure.driverId, "driver") : null;
    return {
      ok: true,
      booking: {
        ticketCode,
        passengerName: first.passengerName,
        tourId: first.tourId,
        tourTitle: tour?.title ?? "",
        departureDate,
        departureTime,
        departurePlace: tour?.departurePlace ?? "",
        adults: first.adults,
        children: first.children,
        seatNumbers: [
          ...new Set(rows.map((row) => row.seatNumber).filter((seat) => seat > 0)),
        ].sort((a, b) => a - b),
        status: cancelled ? "cancelled" : first.status,
        paid: first.paymentStatus === "SUCCESS",
        amount: rows.reduce((sum, row) => sum + row.amount, 0),
        crewRevealed: showCrew,
        guide,
        driver,
      },
    };
  } catch {
    return {
      ok: false,
      code: "failed",
      message: "Ամրագրումը հիմա չբեռնվեց։ Փորձեք մի փոքր հետո։",
    };
  }
}
