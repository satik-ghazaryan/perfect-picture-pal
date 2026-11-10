import { format, parseISO } from "date-fns";
import { hy } from "date-fns/locale";
import { departureBookingClosed } from "./departure-deadline.ts";
import { nextOpenDeparture, type PublicTourFact } from "./tour-chat-facts.ts";

export type ChatDepartureChoice = {
  id: string;
  date: string;
  label: string;
  seats: number;
  time: string | null;
};

export type ChatBookingOffer = {
  mode: "choose-tour" | "departures";
  tourId: string | null;
  title: string | null;
  place: string | null;
  party: number | null;
  price: number | null;
  cashbackPercent: number | null;
  departures: ChatDepartureChoice[];
  tours: { id: string; title: string }[];
  fixture?: boolean;
};

export type BookingLive = {
  id: string;
  tourId: string;
  date: string;
  time: string | null;
  place: string | null;
  price: number | null;
  seats: number;
  cashbackPercent: number;
};

export type BookingExpectation = {
  date: string;
  price: number;
  seats: number;
  cashbackPercent: number;
  party: number;
};

export type BookingCheck =
  | { ok: true; total: number | null; priceKnown: boolean }
  | {
      ok: false;
      code: "stale" | "sold_out" | "closed" | "missing";
      message: string;
      fresh: { date: string; price: number; seats: number; cashbackPercent: number; total: number | null } | null;
    };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function wantsBooking(text: string) {
  return /ամրագր|book/.test(text.toLocaleLowerCase("hy"));
}

export function partyFromMessage(text: string) {
  const match = /(\d{1,2})\s*տեղ/.exec(text.toLocaleLowerCase("hy"));
  if (!match) return null;
  const party = Number(match[1]);
  if (!Number.isInteger(party) || party < 1 || party > 30) return null;
  return party;
}

export function validGuestPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15;
}

export function validConfirmationToken(value: string) {
  return /^[A-Za-z0-9_-]{16,80}$/.test(value);
}

function dateLabel(date: string) {
  if (!DAY.test(date)) return null;
  const parsed = parseISO(date);
  if (Number.isNaN(parsed.getTime())) return null;
  return format(parsed, "d MMMM yyyy", { locale: hy });
}

export function openBookingDepartures(tour: PublicTourFact, now = new Date()): ChatDepartureChoice[] {
  const choices: ChatDepartureChoice[] = [];
  const seen = new Set<string>();
  const rows = tour.departures
    .filter((row) => row.id && row.seats !== null && row.seats > 0)
    .slice()
    .sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id));
  for (const row of rows) {
    const next = nextOpenDeparture(
      { ...tour, departures: [row] },
      now,
    );
    if (!next?.date || next.seats === null || next.id !== row.id) continue;
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    const label = dateLabel(row.date);
    if (!label) continue;
    choices.push({ id: row.id, date: row.date, label, seats: next.seats, time: next.time });
  }
  return choices;
}

export function bookingOffer(input: {
  tour: PublicTourFact | null;
  tours: PublicTourFact[];
  party: number | null;
  now?: Date;
  cashbackPercent?: number | null;
}): { reply: string; booking: ChatBookingOffer } {
  const now = input.now ?? new Date();
  if (!input.tour) {
    const tours = input.tours.slice(0, 6).map((tour) => ({ id: tour.id, title: tour.title }));
    const names = tours.map((tour) => tour.title).join(", ");
    return {
      reply: names ? `Ո՞ր տուրը ամրագրենք՝ ${names}։` : "Ո՞ր տուրը ամրագրենք։",
      booking: {
        mode: "choose-tour",
        tourId: null,
        title: null,
        place: null,
        party: input.party,
        price: null,
        cashbackPercent: input.cashbackPercent ?? null,
        departures: [],
        tours,
      },
    };
  }
  const departures = openBookingDepartures(input.tour, now).filter(
    (item) => input.party === null || item.seats >= input.party,
  );
  const priceKnown = input.tour.price !== null && input.tour.price > 0;
  if (departures.length === 0) {
    return {
      reply: `«${input.tour.title}» տուրի առաջիկա բաց մեկնում չկա, ամրագրել հնարավոր չէ։ [Բացել տուրի էջը](/tours/${input.tour.id})`,
      booking: {
        mode: "departures",
        tourId: input.tour.id,
        title: input.tour.title,
        place: input.tour.departurePlace,
        party: input.party,
        price: priceKnown ? input.tour.price : null,
        cashbackPercent: input.cashbackPercent ?? null,
        departures: [],
        tours: [],
      },
    };
  }
  const lines = departures.map(
    (item) => `${item.label}${item.time ? `, ժամը ${item.time}` : ""}, ${item.seats} ազատ տեղ։`,
  );
  const partyText = input.party ? ` ${input.party} տեղով։` : "";
  return {
    reply: `Ընտրեք «${input.tour.title}» տուրի մեկնումը${partyText} ${lines.join(" ")} [Բացել տուրի էջը](/tours/${input.tour.id})`.trim(),
    booking: {
      mode: "departures",
      tourId: input.tour.id,
      title: input.tour.title,
      place: input.tour.departurePlace,
      party: input.party,
      price: priceKnown ? input.tour.price : null,
      cashbackPercent: input.cashbackPercent ?? null,
      departures,
      tours: [],
    },
  };
}

export function bookingSummary(input: {
  title: string;
  dateLabel: string;
  time: string | null;
  place: string | null;
  party: number;
  price: number | null;
}) {
  const priceKnown = input.price !== null && input.price > 0;
  const total = priceKnown ? input.price * input.party : null;
  return [
    `Տուրը՝ ${input.title}։`,
    `Մեկնումը՝ ${input.dateLabel}${input.time ? `, ժամը ${input.time}` : "։ Մեկնման ժամը նշված չէ"}։`,
    input.place ? `Վայրը՝ ${input.place}։` : "Մեկնման վայրը նշված չէ։",
    `Մասնակիցները՝ ${input.party}։`,
    total === null ? "Գինը դեռ նշված չէ։ Ընդհանուր գումար չեմ հաշվում։" : `Ընդամենը՝ ${total} ֏։`,
  ].join(" ");
}

export function checkDepartureBooking(expected: BookingExpectation, live: BookingLive, now = new Date()): BookingCheck {
  if (!live.time || departureBookingClosed(live.date, live.time, now)) {
    return { ok: false, code: "closed", message: "Այս մեկնման ամրագրումն արդեն փակ է", fresh: null };
  }
  const priceKnown = live.price !== null && live.price > 0;
  const livePrice = live.price ?? 0;
  if (live.date !== expected.date || livePrice !== expected.price || live.cashbackPercent !== expected.cashbackPercent) {
    return {
      ok: false,
      code: "stale",
      message: "Գինը կամ մեկնման տվյալները փոխվել են։ Ստուգեք նոր ամփոփումը և հաստատեք նորից։",
      fresh: {
        date: live.date,
        price: livePrice,
        seats: live.seats,
        cashbackPercent: live.cashbackPercent,
        total: priceKnown ? livePrice * expected.party : null,
      },
    };
  }
  if (live.seats < expected.party) {
    return {
      ok: false,
      code: "sold_out",
      message: `Ազատ տեղերը չեն բավարարում։ Հիմա ազատ է ${live.seats} տեղ։`,
      fresh: {
        date: live.date,
        price: livePrice,
        seats: live.seats,
        cashbackPercent: live.cashbackPercent,
        total: priceKnown ? livePrice * expected.party : null,
      },
    };
  }
  if (live.seats !== expected.seats) {
    return {
      ok: false,
      code: "stale",
      message: "Ազատ տեղերը փոխվել են։ Ստուգեք նոր ամփոփումը և հաստատեք նորից։",
      fresh: {
        date: live.date,
        price: livePrice,
        seats: live.seats,
        cashbackPercent: live.cashbackPercent,
        total: priceKnown ? livePrice * expected.party : null,
      },
    };
  }
  return { ok: true, total: priceKnown ? livePrice * expected.party : null, priceKnown };
}

export type IsolatedBooking = {
  key: string;
  fingerprint: string;
  ticketCode: string;
};

export function bookIsolated(input: {
  store: Map<string, IsolatedBooking>;
  key: string;
  proof: string;
  fingerprint: string;
  expected: BookingExpectation;
  live: BookingLive;
  now?: Date;
}) {
  if (!validConfirmationToken(input.key) || !validConfirmationToken(input.proof)) {
    return { ok: false as const, code: "invalid", message: "Հաստատման բանալին սխալ է։" };
  }
  const existing = input.store.get(input.key);
  if (existing) {
    if (existing.fingerprint !== input.fingerprint) {
      return { ok: false as const, code: "confirmation_mismatch", message: "Այս հաստատումը չի համընկնում պատվերի հետ։" };
    }
    return { ok: true as const, repeated: true, ticketCode: existing.ticketCode };
  }
  const check = checkDepartureBooking(input.expected, input.live, input.now);
  if (!check.ok) return { ok: false as const, code: check.code, message: check.message, fresh: check.fresh };
  const ticketCode = `AG-TEST${input.store.size + 1}`;
  input.store.set(input.key, { key: input.key, fingerprint: input.fingerprint, ticketCode });
  return { ok: true as const, repeated: false, ticketCode };
}

export function isolatedBookingChecks(now = new Date("2026-11-09T10:00:00.000Z")) {
  const live = (patch: Partial<BookingLive> = {}): BookingLive => ({
    id: "dep-isolated-1",
    tourId: "garni",
    date: "2026-11-30",
    time: "08:30",
    place: "Արմավիր քաղաք, Կենտրոնական հրապարակ",
    price: 12000,
    seats: 4,
    cashbackPercent: 5,
    ...patch,
  });
  const expected: BookingExpectation = { date: "2026-11-30", price: 12000, seats: 4, cashbackPercent: 5, party: 2 };
  const store = new Map<string, IsolatedBooking>();
  const key = "isolated-key-0001";
  const proof = "isolated-proof-01";
  const fingerprint = "dep-isolated-1|2|Անուն|00000000";
  const success = bookIsolated({ store, key, proof, fingerprint, expected, live: live(), now });
  const repeat = bookIsolated({ store, key, proof, fingerprint, expected, live: live(), now });
  const changedPrice = checkDepartureBooking(expected, live({ price: 15000 }), now);
  const full = checkDepartureBooking(expected, live({ seats: 1 }), now);
  const started = checkDepartureBooking(expected, live({ date: "2026-11-09", time: "08:30" }), now);
  return {
    success,
    repeat,
    changedPrice,
    full,
    started,
    cancelled: { booked: false as const },
  };
}

const previewBookings = new Map<string, IsolatedBooking>();

function yerevanDay(now: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Yerevan" }).format(now);
}

export function previewFixtureOffer(now = new Date()): { reply: string; booking: ChatBookingOffer } {
  const openDate = "2026-12-20";
  return {
    reply: "Սա միայն Preview-ի մեկուսացված փորձ է։ Արտադրական ամրագրում չի գրվում։ Ընտրեք մեկնումը։",
    booking: {
      mode: "departures",
      tourId: "chat-test",
      title: "Թեստային տուր",
      place: "Արմավիր քաղաք, Կենտրոնական հրապարակ",
      party: 2,
      price: 12000,
      cashbackPercent: 5,
      fixture: true,
      tours: [],
      departures: [
        { id: "chat-test-open", date: openDate, label: `${dateLabel(openDate) ?? openDate}, բաց`, seats: 4, time: "08:30" },
        { id: "chat-test-price", date: openDate, label: "Գինը կփոխվի հաստատման պահին", seats: 4, time: "08:30" },
        { id: "chat-test-full", date: openDate, label: "Տեղերը լրացած են", seats: 4, time: "08:30" },
        { id: "chat-test-closed", date: yerevanDay(now), label: "Մեկնումն արդեն սկսվել է", seats: 4, time: "00:01" },
      ],
    },
  };
}

export function confirmPreviewFixture(input: {
  departureId: string;
  party: number;
  key: string;
  proof: string;
  expectedPrice: number;
  expectedSeats: number;
  expectedDate: string;
  expectedCashback: number;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const openDate = "2026-12-20";
  const known = ["chat-test-open", "chat-test-price", "chat-test-full", "chat-test-closed"];
  if (!known.includes(input.departureId)) {
    return { ok: false as const, code: "missing", message: "Մեկնման տվյալները չբեռնվեցին։ Թիվ չեմ նշում։" };
  }
  const live: BookingLive = {
    id: input.departureId,
    tourId: "chat-test",
    date: input.departureId === "chat-test-closed" ? yerevanDay(now) : openDate,
    time: input.departureId === "chat-test-closed" ? "00:01" : "08:30",
    place: "Արմավիր քաղաք, Կենտրոնական հրապարակ",
    price: input.departureId === "chat-test-price" ? 15000 : 12000,
    seats: input.departureId === "chat-test-full" ? 0 : 4,
    cashbackPercent: 5,
  };
  const fingerprint = `${input.departureId}|${input.party}|${input.expectedPrice}|${input.expectedDate}`;
  return bookIsolated({
    store: previewBookings,
    key: input.key,
    proof: input.proof,
    fingerprint,
    expected: {
      date: input.expectedDate,
      price: input.expectedPrice,
      seats: input.expectedSeats,
      cashbackPercent: input.expectedCashback,
      party: input.party,
    },
    live,
    now,
  });
}
