import { format, parseISO } from "date-fns";
import { hy } from "date-fns/locale";
import { departureBookingClosed } from "./departure-deadline.ts";

export type PublicDepartureFact = {
  date: string;
  seats: number | null;
};

export type PublicTourFact = {
  id: string;
  title: string;
  price: number | null;
  departureTime: string | null;
  isVirtual: boolean;
  departures: PublicDepartureFact[];
};

export type ChatFacts = {
  ok: boolean;
  tours: PublicTourFact[];
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
    if (!TOUR_ID.test(tourId) || !DAY.test(date)) continue;
    const list = departures.get(tourId) ?? [];
    list.push({ date, seats: finiteSeats(record["available_seats"]) });
    departures.set(tourId, list);
  }
  const tours: PublicTourFact[] = [];
  for (const row of tourRows) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const id = typeof record["id"] === "string" ? record["id"] : "";
    const title = typeof record["title_hy"] === "string" ? record["title_hy"].trim() : "";
    if (!TOUR_ID.test(id) || !title) continue;
    tours.push({
      id,
      title,
      price: finitePrice(record["price"]),
      departureTime: clock(record["departure_time"]),
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

function needsTour(text: string) {
  return (
    wants(text, /գին|արժե|արժեք|price/) ||
    wants(text, /մեկնում|հաջորդ|ամսաթիվ|departure/) ||
    wants(text, /տեղ|ազատ|seat/) ||
    wants(text, /ժամ/) ||
    wants(text, /ամրագր|book/)
  );
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
      return { date: row.date, seats: row.seats, time: null as string | null };
    }
    if (departureBookingClosed(row.date, tour.departureTime, now)) continue;
    return { date: row.date, seats: row.seats, time: tour.departureTime };
  }
  return unreadableSeats ? { date: null, seats: null, time: null } : null;
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

function priceLine(tour: PublicTourFact) {
  if (tour.price === null || tour.price === 0) return `${tour.title}։ Գինը դեռ նշված չէ։`;
  return `${tour.title} տուրի գինը այս պահին ${tour.price} ֏ է։`;
}

function timeLine(tour: PublicTourFact) {
  if (!tour.departureTime) return `${tour.title} տուրի մեկնման ժամը հրապարակված չէ։ Ժամ չեմ նշում։`;
  return `${tour.title} տուրի մեկնման ժամը ${tour.departureTime} է։`;
}

function departureLine(tour: PublicTourFact, now: Date) {
  const next = nextOpenDeparture(tour, now);
  if (!next) return `${tour.title} տուրի առաջիկա բաց մեկնում այս պահին չկա։ Ազատ տեղերի թիվ չեմ նշում։`;
  if (!next.date || next.seats === null) {
    return `${tour.title} տուրի ազատ տեղերը չբեռնվեցին։ Տեղերի թիվ չեմ նշում։`;
  }
  const label = dateLabel(next.date);
  if (!label) return `${tour.title} տուրի հաջորդ մեկնման ամսաթիվը չբեռնվեց։ Ամսաթիվ և տեղերի թիվ չեմ նշում։`;
  const time = next.time ? `, ժամը ${next.time}` : "։ Մեկնման ժամը հրապարակված չէ, այդ պատճառով ժամ չեմ նշում";
  return `${tour.title} տուրի հաջորդ բաց մեկնումը ${label} է${time}։ Ազատ տեղերը՝ ${next.seats}։`;
}

function bookingLine(tour: PublicTourFact) {
  return `Ամրագրում չեմ կատարում և վճարում չեմ ընդունում։ ${tour.title} տուրի ամրագրման ձևը տուրի էջում է՝ ${tourLink(tour)}։ Այնտեղ կարող եք սեղմել «Ամրագրել հիմա»։`;
}

function unavailable() {
  return "Տուրերի հրապարակային տվյալները հիմա չբեռնվեցին։ Գին, ժամ կամ ազատ տեղերի թիվ չեմ նշում։ Ամրագրումը մնում է տուրի էջում։";
}

export function answerTourQuestion(input: {
  message: string;
  pageTourId?: string | null;
  facts: ChatFacts;
  now?: Date;
  history?: ChatTurn[];
}) {
  const message = input.message.trim();
  const now = input.now ?? new Date();
  if (!input.facts.ok) return unavailable();
  const tours = input.facts.tours;
  const current = mentioned(message, tours);
  if (current.length > 1) return clarify(tours);
  let tour = current[0] ?? null;
  const pageId = input.pageTourId && TOUR_ID.test(input.pageTourId) ? input.pageTourId : "";
  if (!tour && pageId) tour = tours.find((item) => item.id === pageId) ?? null;
  if (!tour) {
    const earlier = mentioned(
      (input.history ?? [])
        .filter((turn) => turn.role === "user")
        .map((turn) => turn.text)
        .join(" "),
      tours,
    );
    if (earlier.length === 1) tour = earlier[0] ?? null;
  }
  if (!tour && needsTour(message)) return clarify(tours);
  if (!tour) {
    return "Կարող եմ ասել հրապարակված գինը, հաջորդ մեկնումը, ժամը և ազատ տեղերը։ Գրեք տուրի անունը կամ բացեք տուրի էջը։ Ամրագրում չեմ կատարում։";
  }
  const lines: string[] = [];
  const askPrice = wants(message, /գին|արժե|արժեք|price/);
  const askDeparture = wants(message, /մեկնում|հաջորդ|ամսաթիվ|departure/);
  const askSeats = wants(message, /տեղ|ազատ|seat/);
  const askTime = wants(message, /ժամ/);
  const askBooking = wants(message, /ամրագր|book/);
  if (askPrice) lines.push(priceLine(tour));
  if (askDeparture || askSeats) lines.push(departureLine(tour, now));
  else if (askTime) lines.push(timeLine(tour));
  if (askBooking) lines.push(bookingLine(tour));
  if (lines.length === 0) {
    lines.push(`${tour.title} տուրի մասին կարող եմ ասել գինը, մեկնման ժամը, հաջորդ բաց մեկնումը և ազատ տեղերը։ Ամրագրում չեմ կատարում։`);
  }
  if (!lines.some((line) => line.includes(tourLink(tour)))) lines.push(`Էջը՝ ${tourLink(tour)}։`);
  return lines.join(" ");
}

export function replyKeepsPublishedFacts(grounded: string, candidate: string) {
  const allowed = new Set(grounded.match(/\d+/g) ?? []);
  const used = candidate.match(/\d+/g) ?? [];
  if (!used.every((value) => allowed.has(value))) return false;
  const link = grounded.match(/\/tours\/[a-z0-9-]+/);
  return !link || candidate.includes(link[0]);
}
