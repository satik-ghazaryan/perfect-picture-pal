import { format, parseISO } from "date-fns";
import { hy } from "date-fns/locale";
import { departureBookingClosed } from "./departure-deadline.ts";
import { bookingOffer, wantsBooking, partyFromMessage, type ChatBookingOffer } from "./tour-chat-booking.ts";
import type { InterestOffer } from "./tour-interest.ts";

export type PublicDepartureFact = {
  id: string;
  date: string;
  seats: number | null;
};

export type PublicTourFact = {
  id: string;
  title: string;
  price: number | null;
  departureTime: string | null;
  departurePlace: string | null;
  isVirtual: boolean;
  departures: PublicDepartureFact[];
};

export type ChatFacts = {
  ok: boolean;
  tours: PublicTourFact[];
  cashbackPercent?: number | null;
};

export type ChatAnswer = {
  reply: string;
  booking: ChatBookingOffer | null;
  interest: InterestOffer | null;
};

export type ChatTurn = {
  role: "user" | "assistant";
  text: string;
};

const TOUR_ID = /^[a-z0-9-]{1,64}$/;
const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const ALIASES: Record<string, string[]> = {
  garni: ["garni", "գառնի", "գառնու"],
  sevan: ["sevan", "սևան", "սեւան"],
  tatev: ["tatev", "տաթև", "տաթեւ"],
};

export function yerevanDateISO(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Yerevan",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function normalize(text: string) {
  return text
    .toLocaleLowerCase("hy")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function finitePrice(value: unknown) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 1_000_000) return null;
  return value;
}

function finiteSeats(value: unknown) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 500) return null;
  return value;
}

function clock(value: unknown) {
  if (typeof value !== "string") return null;
  const match = CLOCK.exec(value.trim());
  return match ? `${match[1]}:${match[2]}` : null;
}

export function publicFactsFromRows(tourRows: unknown, departureRows: unknown): ChatFacts {
  if (!Array.isArray(tourRows) || !Array.isArray(departureRows)) return { ok: false, tours: [] };
  const departures = new Map<string, PublicDepartureFact[]>();
  for (const row of departureRows) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const tourId = typeof record["tour_id"] === "string" ? record["tour_id"] : "";
    const date = typeof record["departure_date"] === "string" ? record["departure_date"] : "";
    const departureId = typeof record["id"] === "string" ? record["id"].trim() : "";
    if (!TOUR_ID.test(tourId) || !DAY.test(date)) continue;
    const list = departures.get(tourId) ?? [];
    list.push({
      id: /^[A-Za-z0-9-]{8,80}$/.test(departureId) ? departureId : "",
      date,
      seats: finiteSeats(record["available_seats"]),
    });
    departures.set(tourId, list);
  }
  const tours: PublicTourFact[] = [];
  for (const row of tourRows) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const id = typeof record["id"] === "string" ? record["id"] : "";
    const title = typeof record["title_hy"] === "string" ? record["title_hy"].trim() : "";
    if (!TOUR_ID.test(id) || !title) continue;
    const place = typeof record["departure_place"] === "string" ? record["departure_place"].trim() : "";
    tours.push({
      id,
      title,
      price: finitePrice(record["price"]),
      departureTime: clock(record["departure_time"]),
      departurePlace: place || null,
      isVirtual: record["is_virtual_only"] === true,
      departures: departures.get(id) ?? [],
    });
  }
  tours.sort((left, right) => left.title.localeCompare(right.title, "hy"));
  return { ok: true, tours: tours.filter((tour) => !tour.isVirtual) };
}

function aliases(tour: PublicTourFact) {
  const names = new Set(ALIASES[tour.id] ?? []);
  const title = normalize(tour.title);
  if (title.length >= 3) names.add(title);
  return [...names];
}

function mentioned(text: string, tours: PublicTourFact[]) {
  const normalized = normalize(text);
  if (!normalized) return [];
  return tours.filter((tour) => aliases(tour).some((name) => name.length >= 3 && normalized.includes(name)));
}

function wants(text: string, pattern: RegExp) {
  return pattern.test(normalize(text));
}

function dateLabel(date: string) {
  const parsed = parseISO(date);
  if (Number.isNaN(parsed.getTime()) || !DAY.test(date)) return null;
  return format(parsed, "d MMMM yyyy", { locale: hy });
}

export function nextOpenDeparture(tour: PublicTourFact, now = new Date()) {
  const today = yerevanDateISO(now);
  const rows = tour.departures
    .filter((row) => row.date >= today)
    .slice()
    .sort((left, right) => left.date.localeCompare(right.date));
  let unreadableSeats = false;
  for (const row of rows) {
    if (row.seats === null) {
      unreadableSeats = true;
      continue;
    }
    if (row.seats <= 0) continue;
    if (!tour.departureTime) {
      if (row.date === today) continue;
      return { id: row.id, date: row.date, seats: row.seats, time: null as string | null };
    }
    if (departureBookingClosed(row.date, tour.departureTime, now)) continue;
    return { id: row.id, date: row.date, seats: row.seats, time: tour.departureTime };
  }
  return unreadableSeats ? { id: "", date: null, seats: null, time: null } : null;
}

function tourLink(tour: PublicTourFact) {
  return `/tours/${tour.id}`;
}

function clarify(tours: PublicTourFact[]) {
  const dayTours = tours.filter((tour) => !tour.isVirtual);
  const names = dayTours.map((tour) => tour.title).slice(0, 6);
  if (names.length === 0) return "Ո՞ր տուրի մասին է խոսքը։ Բացեք տուրի էջը կամ գրեք տուրի անունը։";
  return `Ո՞ր տուրի մասին է խոսքը՝ ${names.join(", ")}։`;
}

function pageLink(tour: PublicTourFact) {
  return `[Բացել տուրի էջը](${tourLink(tour)})`;
}

function priceSentence(tour: PublicTourFact) {
  if (tour.price === null || tour.price === 0) return "Գինը դեռ նշված չէ։";
  return `Գինը ${tour.price} ֏ է։`;
}

function placeSentence(tour: PublicTourFact) {
  if (!tour.departurePlace) return "Մեկնման վայրը նշված չէ։";
  return `Մեկնման վայրը՝ ${tour.departurePlace}։`;
}

function timeSentence(tour: PublicTourFact) {
  if (!tour.departureTime) return "Մեկնման ժամը նշված չէ։";
  return `Մեկնման ժամը ${tour.departureTime} է։`;
}

function departureSentence(tour: PublicTourFact, now: Date) {
  const next = nextOpenDeparture(tour, now);
  if (!next) return "Առաջիկա բաց մեկնում այս պահին չկա։";
  if (!next.date || next.seats === null) return "Ազատ տեղերը չբեռնվեցին։ Թիվ չեմ նշում։";
  const label = dateLabel(next.date);
  if (!label) return "Հաջորդ մեկնման ամսաթիվը չբեռնվեց։ Թիվ չեմ նշում։";
  const time = next.time ? `, ժամը ${next.time}` : "։ Մեկնման ժամը նշված չէ";
  return `Հաջորդ բաց մեկնումը ${label}-ն է${time}։ Ազատ տեղերը՝ ${next.seats}։`;
}

function summary(tour: PublicTourFact, now: Date) {
  const route = tour.departurePlace
    ? `«${tour.title}» երթուղին է։ ${placeSentence(tour)}`
    : `«${tour.title}» երթուղին է։`;
  return [route, priceSentence(tour), departureSentence(tour, now), pageLink(tour)].join(" ");
}

function asksSomething(text: string) {
  return (
    wants(text, /գին|արժե|արժեք|price/) ||
    wants(text, /մեկնում|հաջորդ|ամսաթիվ|departure/) ||
    wants(text, /տեղ|ազատ|seat/) ||
    wants(text, /ժամ/) ||
    wants(text, /որտեղ|վայր/)
  );
}

function continuesOffer(text: string) {
  return /^(ասա|ասացիր|պատմիր|շարունակիր)( ինձ| էլի)?$/.test(normalize(text));
}

function latestUserTour(history: ChatTurn[] | undefined, tours: PublicTourFact[]) {
  const turns = [...(history ?? [])].reverse();
  for (const turn of turns) {
    if (turn.role !== "user") continue;
    const found = mentioned(turn.text, tours);
    if (found.length === 1) return found[0] ?? null;
  }
  return null;
}

function isDirectionStop(word: string) {
  if (DIRECTION_STOP.has(word)) return true;
  for (const stop of DIRECTION_STOP) {
    if (stop.length >= 4 && word.startsWith(stop)) return true;
  }
  return false;
}

const DIRECTION_STOP = new Set([
  "գին", "գինը", "արժե", "արժեք", "price",
  "ժամ", "ժամը", "մեկնում", "հաջորդ", "ամսաթիվ",
  "տեղ", "տեղը", "ազատ", "seat",
  "ասա", "ասացիր", "պատմիր", "շարունակիր",
  "տուր", "տուրը", "տուրեր", "տուրի",
  "ուզում", "եմ", "կա", "կան", "ինձ", "մասին",
  "որ", "որը", "ինչ", "ես", "ձեզ", "իսկ", "քանի", "քանիսն", "բարև",
  "տեղեկացրեք", "երբ", "լինի",
  "ամրագրել", "ամրագրիր", "book",
  "բաց", "բացել", "էջը",
]);

export function unknownDirection(message: string, tours: PublicTourFact[]) {
  if (mentioned(message, tours).length > 0) return null;
  const tokens = message.split(/[^\p{L}\p{N}-]+/u).filter((token) => {
    const word = normalize(token);
    return word.length >= 3 && !isDirectionStop(word) && !/^\d+$/.test(word);
  });
  if (tokens.length !== 1) return null;
  const label = tokens[0] ?? "";
  return { key: normalize(label), label };
}

export function catalogInterest(tour: PublicTourFact, now = new Date()): InterestOffer | null {
  const next = nextOpenDeparture(tour, now);
  if (next?.date && next.seats !== null) return null;
  if (next && (!next.date || next.seats === null)) return null;
  return { tourId: tour.id, label: tour.title };
}

function unavailable(): ChatAnswer {
  return {
    reply: "Տուրերի հրապարակային տվյալները հիմա չբեռնվեցին։ Գին, ժամ կամ ազատ տեղերի թիվ չեմ նշում։",
    booking: null,
    interest: null,
  };
}

export function answerTourChat(input: {
  message: string;
  pageTourId?: string | null;
  facts: ChatFacts;
  now?: Date;
  history?: ChatTurn[];
}): ChatAnswer {
  const message = input.message.trim();
  const now = input.now ?? new Date();
  if (!input.facts.ok) return unavailable();
  const tours = input.facts.tours;
  const named = mentioned(message, tours);
  if (named.length > 1) return { reply: clarify(tours), booking: null, interest: null };
  const unknown = named.length === 0 ? unknownDirection(message, tours) : null;
  if (unknown) {
    return {
      reply: `«${unknown.label}» ուղղությունը կատալոգում չկա։`,
      booking: null,
      interest: { tourId: null, label: unknown.label },
    };
  }
  const pageId = input.pageTourId && TOUR_ID.test(input.pageTourId) ? input.pageTourId : "";
  const tour =
    named[0] ??
    latestUserTour(input.history, tours) ??
    (pageId ? (tours.find((item) => item.id === pageId) ?? null) : null);
  if (wantsBooking(message)) {
    const offer = bookingOffer({
      tour,
      tours,
      party: partyFromMessage(message),
      now,
      cashbackPercent: input.facts.cashbackPercent ?? null,
    });
    return { ...offer, interest: tour ? catalogInterest(tour, now) : null };
  }
  if (!tour) return { reply: clarify(tours), booking: null, interest: null };
  const askPrice = wants(message, /գին|արժե|արժեք|price/);
  const askDeparture = wants(message, /մեկնում|հաջորդ|ամսաթիվ|departure/);
  const askSeats = wants(message, /տեղ|ազատ|seat/);
  const askTime = wants(message, /ժամ/);
  const askPlace = wants(message, /որտեղ|վայր/);
  const interest = catalogInterest(tour, now);
  if (!asksSomething(message) && (named.length === 1 || continuesOffer(message))) {
    return { reply: summary(tour, now), booking: null, interest };
  }
  const lines: string[] = [];
  if (askPrice) lines.push(priceSentence(tour));
  if (askPlace && !askSeats) lines.push(placeSentence(tour));
  if (askTime && !askDeparture && !askSeats) lines.push(timeSentence(tour));
  if (askDeparture || askSeats) lines.push(departureSentence(tour, now));
  if (lines.length === 0) return { reply: "Գինը, ժամը, մեկնման վայրը, թե՞ ազատ տեղերը։", booking: null, interest };
  lines.push(pageLink(tour));
  return { reply: lines.join(" "), booking: null, interest };
}

export function answerTourQuestion(input: {
  message: string;
  pageTourId?: string | null;
  facts: ChatFacts;
  now?: Date;
  history?: ChatTurn[];
}) {
  return answerTourChat(input).reply;
}

export function replyKeepsPublishedFacts(grounded: string, candidate: string) {
  const allowed = new Set(grounded.match(/\d+/g) ?? []);
  const used = candidate.match(/\d+/g) ?? [];
  if (!used.every((value) => allowed.has(value))) return false;
  const link = grounded.match(/\/tours\/[a-z0-9-]+/);
  return !link || candidate.includes(link[0]);
}
