export const LEGACY_NO_DATE = "Ամրագրման սեփական տվյալներով մեկնումը միանշանակ չէ։";
export const LEGACY_UNVERIFIED_LINK =
  "Նոր հոսքով չի ստեղծվել և ամրագրման սեփական ամսաթիվ չկա. կապը մնացել է ձեռքով վերանայման։";

export type BookableDeparture = {
  id: string;
  tourId: string;
  departureDate: string;
  availableSeats: number;
  price: number;
};

export type DepartureQuote = {
  departureId: string;
  departureDate: string;
  unitPrice: number;
  availableSeats: number;
  cashbackPercent: number;
};

export type LegacyBookingLink = {
  id: string;
  tourId: string;
  ticketCode: string;
  departureId: string | null;
  confirmed?: boolean;
};

export function localDateISO(now = new Date()) {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function listBookableDepartures(rows: BookableDeparture[], today = localDateISO()) {
  return rows
    .filter((row) => row.departureDate >= today && row.availableSeats > 0)
    .slice()
    .sort(
      (left, right) =>
        left.departureDate.localeCompare(right.departureDate) || left.id.localeCompare(right.id),
    );
}

export function partySize(adults: number, children: number) {
  if (!Number.isInteger(adults) || !Number.isInteger(children)) return null;
  if (adults < 1 || children < 0) return null;
  return adults + children;
}

export function groupSeatNumbers(firstSeat: number, count: number) {
  if (!Number.isInteger(firstSeat) || firstSeat < 1 || !Number.isInteger(count) || count < 1)
    return [];
  return Array.from({ length: count }, (_, index) => firstSeat + index);
}

export function departureTotal(unitPrice: number, seats: number) {
  if (!Number.isInteger(unitPrice) || unitPrice < 0 || !Number.isInteger(seats) || seats < 1)
    return null;
  return unitPrice * seats;
}

export function quoteChanged(expected: DepartureQuote, current: DepartureQuote) {
  return (
    expected.departureId !== current.departureId ||
    expected.departureDate !== current.departureDate ||
    expected.unitPrice !== current.unitPrice ||
    expected.availableSeats !== current.availableSeats ||
    expected.cashbackPercent !== current.cashbackPercent
  );
}

export type SeatDecision =
  | { result: "booked"; bookingId: string; seats: number; firstSeat: number }
  | { result: "repeat"; bookingId: string; seats: number }
  | { result: "sold_out"; seats: number }
  | { result: "stale"; seats: number };

type SeatState = {
  seats: number;
  nextSeat: number;
  keys: Record<string, string>;
};

export function decideDepartureBooking(
  state: SeatState,
  request: { key: string; party: number; expectedSeats: number },
): { state: SeatState; decision: SeatDecision } {
  const existing = state.keys[request.key];
  if (existing)
    return { state, decision: { result: "repeat", bookingId: existing, seats: state.seats } };
  if (state.seats < request.party)
    return { state, decision: { result: "sold_out", seats: state.seats } };
  if (state.seats !== request.expectedSeats)
    return { state, decision: { result: "stale", seats: state.seats } };
  const bookingId = `booking-${Object.keys(state.keys).length + 1}`;
  return {
    state: {
      seats: state.seats - request.party,
      nextSeat: state.nextSeat + request.party,
      keys: { ...state.keys, [request.key]: bookingId },
    },
    decision: {
      result: "booked",
      bookingId,
      seats: state.seats - request.party,
      firstSeat: state.nextSeat,
    },
  };
}

export function orderFingerprint(input: {
  departureId: string;
  adults: number;
  children: number;
  phone: string;
  name: string;
  usePoints: boolean;
}) {
  return [
    input.departureId,
    input.adults,
    input.children,
    input.phone.replace(/\D/g, ""),
    input.name.trim().toLowerCase(),
    input.usePoints ? "1" : "0",
  ].join("|");
}

export function confirmationAccess(
  stored: { booker: string; proof: string; fingerprint: string } | null,
  request: { booker: string; proof: string; fingerprint: string },
) {
  if (!stored) return "create" as const;
  if (
    stored.booker !== request.booker ||
    stored.proof !== request.proof ||
    stored.fingerprint !== request.fingerprint
  ) {
    return "reject" as const;
  }
  return "repeat" as const;
}

export function shouldDeliverTicket(repeated: boolean, notify: boolean) {
  return notify && !repeated;
}

export function planLegacyBookingLinks(bookings: LegacyBookingLink[]) {
  const links: { bookingId: string; departureId: string }[] = [];
  const conflicts: { bookingId: string; tourId: string; ticketCode: string; reason: string }[] = [];
  const reviews: { bookingId: string; tourId: string; ticketCode: string; reason: string }[] = [];
  for (const booking of bookings) {
    if (booking.departureId) {
      if (!booking.confirmed) {
        reviews.push({
          bookingId: booking.id,
          tourId: booking.tourId,
          ticketCode: booking.ticketCode,
          reason: LEGACY_UNVERIFIED_LINK,
        });
      }
      continue;
    }
    conflicts.push({
      bookingId: booking.id,
      tourId: booking.tourId,
      ticketCode: booking.ticketCode,
      reason: LEGACY_NO_DATE,
    });
  }
  return { links, conflicts, reviews };
}
