import { format, parseISO } from "date-fns";
import { hy } from "date-fns/locale";
import { departureBookingClosed } from "./departure-deadline.ts";
import {
  bookingOffer,
  wantsBooking,
  partyFromMessage,
  type ChatBookingOffer,
} from "./tour-chat-booking.ts";
import { directionKey, type InterestOffer } from "./tour-interest.ts";

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
  highlights: string[];
  included: string[];
  excluded: string[];
  isVirtual: boolean;
  location: string | null;
  departures: PublicDepartureFact[];
};

export type ChatFacts = {
  ok: boolean;
  tours: PublicTourFact[];
  cashbackPercent?: number | null;
};

export type ChatChoice = { id: string; title: string };

export type ChatAnswer = {
  reply: string;
  booking: ChatBookingOffer | null;
  interest: InterestOffer | null;
  choices: ChatChoice[] | null;
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
  sevan: ["sevan", "սևան", "սեւան", "սևան դիլիջան և հաղարծին", "սեւան դիլիջան և հաղարծին"],
  tatev: ["tatev", "տաթև", "տաթեւ"],
  lori: ["lori", "լոռի", "լոռու"],
  "dilijan-autumn": ["dilijan", "դիլիջան", "դիլիջանի", "աշնանային դիլիջան", "աշնանային դիլիջանի"],
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
    .replace(/[՞՛՝]/gu, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function finitePrice(value: unknown) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 1_000_000)
    return null;
  return value;
}

function finiteSeats(value: unknown) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 500)
    return null;
  return value;
}

function clock(value: unknown) {
  if (typeof value !== "string") return null;
  const match = CLOCK.exec(value.trim());
  return match ? `${match[1]}:${match[2]}` : null;
}

function textList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((item) => (typeof item === "string" && item.trim() ? [item.trim().slice(0, 160)] : []))
    .slice(0, 12);
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
    const place =
      typeof record["departure_place"] === "string" ? record["departure_place"].trim() : "";
    const locationHy =
      typeof record["location_hy"] === "string" ? record["location_hy"].trim() : "";
    const region = typeof record["region"] === "string" ? record["region"].trim() : "";
    const location = [locationHy, region]
      .filter((item, index, all) => item && all.indexOf(item) === index)
      .join(" ");
    tours.push({
      id,
      title,
      price: finitePrice(record["price"]),
      departureTime: clock(record["departure_time"]),
      departurePlace: place || null,
      highlights: textList(record["highlights"]),
      included: textList(record["included"]),
      excluded: textList(record["excluded"]),
      isVirtual: record["is_virtual_only"] === true,
      location: location || null,
      departures: departures.get(id) ?? [],
    });
  }
  tours.sort((left, right) => left.title.localeCompare(right.title, "hy"));
  return { ok: true, tours: tours.filter((tour) => !tour.isVirtual) };
}

const TITLE_STOP = new Set(["արմավիր", "արմավիրից", "տուր", "տուրը", "մեկօրյա", "աշնանային"]);

function stem(word: string) {
  const bare = word.replace(/(ներից|ների|ներ|ից|ում|ով|ին|ը|ի|ն)$/u, "");
  return bare.length >= 4 ? bare : word;
}

function titleWords(tour: PublicTourFact) {
  return normalize(tour.title)
    .split(" ")
    .map(stem)
    .filter((word) => word.length >= 4 && !TITLE_STOP.has(word));
}

function aliases(tour: PublicTourFact) {
  const names = new Set(ALIASES[tour.id] ?? []);
  const title = normalize(tour.title);
  if (title.length >= 3) names.add(title);
  for (const word of titleWords(tour)) names.add(word);
  return [...names];
}

const MARZ_NAMES = new Set([
  "սյունիք",
  "կոտայք",
  "գեղարքունիք",
  "տավուշ",
  "լոռի",
  "շիրակ",
  "արագածոտն",
  "արարատ",
  "վայոց ձոր",
]);

const PLACE_MARZ: Record<string, string> = {
  տաթև: "սյունիք",
  տաթեւ: "սյունիք",
  tatev: "սյունիք",
  գառնի: "կոտայք",
  գեղարդ: "կոտայք",
  սևան: "գեղարքունիք",
  սեւան: "գեղարքունիք",
  դիլիջան: "տավուշ",
  հաղարծին: "տավուշ",
  լոռի: "լոռի",
  լոռու: "լոռի",
  գյումրի: "շիրակ",
  ամբերդ: "արագածոտն",
};

function marzesInText(text: string) {
  const normalized = normalize(text);
  const found = new Set<string>();
  if (!normalized) return found;
  if (normalized.includes("վայոց ձոր")) found.add("վայոց ձոր");
  for (const word of normalized.split(" ")) {
    const key = stem(word);
    if (MARZ_NAMES.has(key)) found.add(key);
    if (MARZ_NAMES.has(word)) found.add(word);
  }
  return found;
}

function tourMarzes(tour: PublicTourFact) {
  const found = new Set<string>();
  const sources = [tour.location ?? "", ...aliases(tour)];
  for (const source of sources) {
    const normalized = normalize(source);
    if (!normalized) continue;
    if (normalized.includes("վայոց ձոր")) found.add("վայոց ձոր");
    for (const word of normalized.split(" ")) {
      const key = stem(word);
      if (MARZ_NAMES.has(key)) found.add(key);
      const mapped = PLACE_MARZ[key] ?? PLACE_MARZ[word];
      if (mapped) found.add(mapped);
    }
  }
  return found;
}

function toursInRegion(text: string, tours: PublicTourFact[]) {
  const asked = marzesInText(text);
  if (asked.size === 0) return [];
  return tours.filter((tour) => [...tourMarzes(tour)].some((marz) => asked.has(marz)));
}

function mentioned(text: string, tours: PublicTourFact[]) {
  const normalized = normalize(text);
  if (!normalized) return [];
  const exact = tours.filter((tour) => {
    const title = normalize(tour.title);
    return title.length >= 3 && normalized.includes(title);
  });
  if (exact.length > 0) return exact;
  const phrases = tours.filter((tour) =>
    aliases(tour).some(
      (name) => name.includes(" ") && name.length >= 8 && normalized.includes(name),
    ),
  );
  if (phrases.length > 0) return phrases;
  const stems = normalized.split(" ").map(stem);
  return tours.filter((tour) =>
    aliases(tour).some((name) => {
      if (name.includes(" ")) return false;
      const key = stem(name);
      return (
        key.length >= 4 &&
        (normalized.includes(name) || stems.some((word) => word === key || word.startsWith(key)))
      );
    }),
  );
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
  if (names.length === 0) return "Ո՞ր տուրի մասին է խոսքը։ Բացիր տուրի էջը կամ գրիր տուրի անունը։";
  return `Ո՞ր տուրի մասին է խոսքը՝ ${names.join(", ")}։`;
}

function pageLink(tour: PublicTourFact) {
  return `[Բացել տուրի էջը](${tourLink(tour)})`;
}

function priceSentence(tour: PublicTourFact) {
  if (tour.price === null || tour.price === 0) return unpublishedPrice(shortName(tour));
  return `${genitiveName(shortName(tour))} տուրի գինը ${tour.price} դրամ է։`;
}

function groupPriceSentence(tour: PublicTourFact, party: number | null) {
  if (tour.price === null || tour.price === 0 || !party || party < 2) return priceSentence(tour);
  const total = tour.price * party;
  if (!Number.isSafeInteger(total) || total > 1_000_000) return priceSentence(tour);
  const people = party === 2 ? "Երկու հոգու համար" : `${party} հոգու համար`;
  return `${people}՝ ${total} դրամ (${tour.price} դրամ՝ մեկ անձի համար)։`;
}

function placeSentence(tour: PublicTourFact) {
  if (!tour.departurePlace) return "Մեկնման վայրը նշված չէ։";
  return `Շարժվում ենք այս վայրից՝ ${tour.departurePlace}։`;
}

function timeSentence(tour: PublicTourFact, now: Date) {
  const next = readDeparture(tour, now);
  if (next.kind === "none") return closedLine(tour);
  if (next.kind === "unread" || !next.time) return "Մեկնման ժամը նշված չէ։";
  return `Ժամը ${next.time} է։`;
}

type DepartureRead =
  | { kind: "none" }
  | { kind: "unread" }
  | { kind: "soldout"; date: string; time: string | null }
  | { kind: "open"; date: string; time: string | null; seats: number };

function stillAhead(tour: PublicTourFact, date: string, now: Date) {
  const today = yerevanDateISO(now);
  if (date < today) return false;
  if (!tour.departureTime) return date > today;
  return !departureBookingClosed(date, tour.departureTime, now);
}

function readDeparture(tour: PublicTourFact, now: Date): DepartureRead {
  const rows = tour.departures
    .filter((row) => stillAhead(tour, row.date, now))
    .slice()
    .sort((left, right) => left.date.localeCompare(right.date));
  if (rows.length === 0) return { kind: "none" };
  const open = rows.find((row) => row.seats !== null && row.seats > 0);
  if (open && open.seats !== null)
    return { kind: "open", date: open.date, time: tour.departureTime, seats: open.seats };
  if (rows.some((row) => row.seats === null)) return { kind: "unread" };
  const sold = rows[0];
  return sold ? { kind: "soldout", date: sold.date, time: tour.departureTime } : { kind: "none" };
}

function departureSentence(tour: PublicTourFact, now: Date) {
  const next = readDeparture(tour, now);
  if (next.kind === "none") return closedLine(tour);
  if (next.kind === "unread") return "Մեկնման տվյալները չեն բեռնվել։";
  const label = dateLabel(next.date);
  if (!label) return "Մեկնման տվյալները չեն բեռնվել։";
  const time = next.time ? `, ժամը ${next.time}` : "";
  if (next.kind === "soldout") return soldOutLine(tour, next.date);
  return `Հաջորդ բաց մեկնումը ${label}-ն է${time}։ Ազատ տեղերը՝ ${next.seats}։`;
}

function seatSentence(tour: PublicTourFact, now: Date, party: number | null) {
  const next = readDeparture(tour, now);
  if (next.kind === "none") return closedLine(tour);
  if (next.kind === "unread") return "Մեկնման տվյալները չեն բեռնվել։";
  if (next.kind === "soldout") return soldOutLine(tour, next.date);
  if (party !== null && next.seats >= party)
    return `Այո, ${party} տեղ կա։ Ազատ տեղերը՝ ${next.seats}։`;
  if (party !== null) return `Ոչ, ${party} տեղ չկա։ Ազատ տեղերը՝ ${next.seats}։`;
  return `Ազատ տեղերը՝ ${next.seats}։`;
}

function phoneIn(text: string) {
  const match = text.match(/\+?\d[\d\s-]{6,}\d/u);
  if (!match) return null;
  const digits = match[0].replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  return match[0].replace(/\s+/g, " ").trim();
}

function isContactItem(text: string) {
  return /կապ|հեռախոս|phone|tel/u.test(normalize(text)) || phoneIn(text) !== null;
}

function routePlaces(tour: PublicTourFact) {
  return routeStops(tour);
}

function isFoodStop(text: string) {
  return /ֆուդ|կորտ|food/u.test(normalize(text));
}

function routeStops(tour: PublicTourFact) {
  return tour.highlights.filter((item) => !isContactItem(item) && !isFoodStop(item));
}

function routeSentence(tour: PublicTourFact) {
  const stops = routeStops(tour);
  if (stops.length === 0) return `Երթուղին՝ ${tour.title}։`;
  return `Երթուղին՝ ${stops.join(", ")}։`;
}

const MONTHS = [
  "հունվարի",
  "փետրվարի",
  "մարտի",
  "ապրիլի",
  "մայիսի",
  "հունիսի",
  "հուլիսի",
  "օգոստոսի",
  "սեպտեմբերի",
  "հոկտեմբերի",
  "նոյեմբերի",
  "դեկտեմբերի",
];

const GENITIVE: Record<string, string> = {
  լոռի: "Լոռու",
  գյումրի: "Գյումրիի",
  ամբերդ: "Ամբերդի",
  գառնի: "Գառնիի",
  տաթև: "Տաթևի",
  տաթեւ: "Տաթևի",
  սևան: "Սևանի",
  սեւան: "Սևանի",
  դիլիջան: "Դիլիջանի",
};

function shortName(tour: PublicTourFact) {
  const label = choiceLabel(tour);
  const simple =
    !label.includes("՝") &&
    !normalize(label).includes("արմավիր") &&
    !label.includes(" և ") &&
    label.split(/\s+/).length <= 2;
  if (simple) return label;
  const armenian = aliases(tour).filter((name) => /^[\u0531-\u0587]+$/u.test(name));
  const picked = armenian.find((name) => normalize(tour.title).includes(name)) ?? armenian[0];
  if (!picked) return label.split(/[՝,]/)[0]?.trim() || label;
  return picked.charAt(0).toLocaleUpperCase("hy") + picked.slice(1);
}

function genitiveName(name: string) {
  const key = normalize(name);
  if (GENITIVE[key]) return GENITIVE[key];
  if (key.startsWith("աշնանային դիլիջան")) return "Աշնանային Դիլիջանի";
  if (key.includes(" ") || key.includes("արմավիր") || /[ուի]$/u.test(key)) return name;
  return `${name}ի`;
}

function unpublishedPrice(name: string) {
  return `${genitiveName(name)} տուրի գինը դեռ հրապարակված չէ։`;
}

function closedLine(tour: PublicTourFact) {
  return `${shortName(tour)} առաջիկա բաց մեկնում դեռ չկա։`;
}

function unavailableBooking(tour: PublicTourFact, now: Date) {
  const next = readDeparture(tour, now);
  const fact = next.kind === "soldout" ? soldOutLine(tour, next.date) : closedLine(tour);
  return `${fact} Ամրագրել հնարավոր չէ։`;
}

function monthLead(date: string) {
  const month = MONTHS[Number(date.slice(5, 7)) - 1];
  const day = Number(date.slice(8, 10));
  if (!month || !day) return null;
  return `${month.charAt(0).toLocaleUpperCase("hy")}${month.slice(1)} ${day}-ի`;
}

function soldOutLine(tour: PublicTourFact, date: string) {
  const lead = monthLead(date);
  if (!lead) return "Մեկնման տվյալները չեն բեռնվել։";
  return `${lead} «${tour.title}» տուրի բոլոր տեղերը զբաղված են։`;
}

function choiceLabel(tour: PublicTourFact) {
  const title = normalize(tour.title);
  if (tour.id === "dilijan-autumn" || (title.includes("աշնանային") && title.includes("դիլիջան")))
    return "Աշնանային Դիլիջան";
  if (
    (title.includes("սևան") || title.includes("սեւան")) &&
    title.includes("դիլիջան") &&
    title.includes("հաղարծին")
  ) {
    return "Սևան, Դիլիջան և Հաղարծին";
  }
  return tour.title;
}

function vividSentence(tour: PublicTourFact) {
  const places = routePlaces(tour).slice(0, 3);
  if (places.length === 0) return null;
  if (places.length === 1) return `Այս օրվա ճանապարհն անցնում է ${places[0]} կողմով։`;
  const last = places[places.length - 1];
  return `Այս օրվա ճանապարհն անցնում է ${places.slice(0, -1).join(", ")} և ${last} կողմով։`;
}

function contactSentence(tour: PublicTourFact) {
  const phones = [...tour.highlights, ...tour.included, ...tour.excluded]
    .map((item) => phoneIn(item))
    .filter((item): item is string => Boolean(item));
  const unique = [...new Set(phones)];
  if (unique.length === 0) return "Հեռախոսահամարը կատալոգում նշված չէ։";
  return `Կապվել կարող ես այս համարով՝ ${unique.join(", ")}։`;
}

function includedSentence(tour: PublicTourFact) {
  const includedItems = tour.included.filter((item) => !isContactItem(item));
  const excludedItems = tour.excluded.filter((item) => !isContactItem(item));
  if (includedItems.length === 0 && excludedItems.length === 0) return "Ներառվածը դեռ նշված չէ։";
  const included =
    includedItems.length > 0
      ? `ներառված է՝ ${includedItems.join(", ")}`
      : "ներառված ծառայությունները դեռ նշված չեն";
  const extra = excludedItems.length > 0 ? ` Առանձին է վճարվում՝ ${excludedItems.join(", ")}։` : "";
  return `«${tour.title}» տուրում ${included}։${extra}`;
}

function summary(tour: PublicTourFact, now: Date) {
  return [
    vividSentence(tour),
    routeSentence(tour),
    priceSentence(tour),
    departureSentence(tour, now),
    pageLink(tour),
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

function fullProgram(tour: PublicTourFact, now: Date) {
  const food = tour.highlights.some((item) => isFoodStop(item))
    ? "Ֆուդ կորտը սնվելու և հանգստանալու կանգառ է։"
    : null;
  return [
    routeSentence(tour),
    food,
    priceSentence(tour),
    includedSentence(tour),
    departureSentence(tour, now),
    pageLink(tour),
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

function upcomingReply(tours: PublicTourFact[], now: Date) {
  let unread = false;
  const lines: { sold: boolean; date: string; text: string }[] = [];
  for (const tour of tours) {
    const rows = tour.departures
      .filter((row) => stillAhead(tour, row.date, now))
      .slice()
      .sort(
        (left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id),
      );
    for (const row of rows) {
      const label = dateLabel(row.date);
      if (!label || row.seats === null) {
        unread = true;
        continue;
      }
      const sold = row.seats <= 0;
      const time = tour.departureTime ? `, ժամը ${tour.departureTime}` : "";
      lines.push({
        sold,
        date: row.date,
        text: sold
          ? soldOutLine(tour, row.date)
          : `«${tour.title}»՝ ${label}${time}, ազատ է ${row.seats} տեղ։`,
      });
    }
  }
  lines.sort(
    (left, right) => Number(left.sold) - Number(right.sold) || left.date.localeCompare(right.date),
  );
  if (lines.length === 0 && unread) return "Մեկնման տվյալները չեն բեռնվել։";
  if (lines.length === 0) return "Առաջիկա մեկնում դեռ չկա։";
  if (lines.every((line) => line.sold)) {
    if (lines.length === 1)
      return lines[0]?.text ?? "Բոլոր հրապարակված մեկնումների տեղերը զբաղված են։";
    const names = lines
      .map((line) => line.text.replace(/ տուրի բոլոր տեղերը զբաղված են։$/, "։"))
      .join(" ");
    return `Բոլոր հրապարակված մեկնումների տեղերը զբաղված են։ ${names}`;
  }
  return lines.map((line) => line.text).join(" ");
}

function repairTypos(text: string) {
  return text.replace(/(^|[^\p{L}])տոր(?=$|[^\p{L}])/giu, "$1տուր");
}

function directionName(label: string) {
  const lower = label.toLocaleLowerCase("hy");
  if (lower === "գյումրի") return "Գյումրիի";
  if (lower === "լոռի") return "Լոռու";
  if (lower === "ամբերդ") return "Ամբերդի";
  if (/[ի]$/u.test(lower)) return label;
  return `${label}ի`;
}

function addDays(iso: string, days: number) {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function weekEnd(today: string) {
  const day = new Date(`${today}T12:00:00Z`).getUTCDay();
  return addDays(today, day === 0 ? 0 : 7 - day);
}

function weekReply(tours: PublicTourFact[], now: Date) {
  const today = yerevanDateISO(now);
  const end = weekEnd(today);
  let unread = false;
  const lines: string[] = [];
  for (const tour of tours) {
    const rows = tour.departures
      .filter((row) => row.date >= today && row.date <= end && stillAhead(tour, row.date, now))
      .slice()
      .sort((left, right) => left.date.localeCompare(right.date));
    for (const row of rows) {
      const label = dateLabel(row.date);
      if (!label || row.seats === null) {
        unread = true;
        continue;
      }
      const time = tour.departureTime ? `, ժամը ${tour.departureTime}` : "";
      const seats = row.seats > 0 ? `ազատ է ${row.seats} տեղ` : "տեղերը սպառվել են";
      lines.push(`«${tour.title}»՝ ${label}${time}, ${seats}։`);
    }
  }
  if (lines.length === 0 && unread) return "Մեկնման տվյալները չեն բեռնվել։";
  if (lines.length === 0) return "Այս շաբաթ առաջիկա մեկնում չկա։";
  if (lines.every((line) => line.includes("տեղերը սպառվել են"))) {
    return `Այս շաբաթ առաջիկա մեկնում կա, բայց տեղերը սպառվել են։ ${lines.join(" ")}`;
  }
  return `Այս շաբաթ մնացել է՝ ${lines.join(" ")}`;
}

function asksFuturePrice(text: string) {
  const normalized = normalize(text);
  return /եթե լինի/.test(normalized) || /ինչքան կլինի/.test(normalized);
}

function asksPrice(text: string) {
  if (asksFuturePrice(text) || wants(text, /գին|արժե|արժի|արժեն|արժեք|կնստ|price/)) return true;
  const party = partyFromMessage(text);
  return party !== null && party >= 2 && !wants(text, /տեղ|ազատ|seat/) && !wantsBooking(text);
}

function asksSomething(text: string) {
  return (
    asksPrice(text) ||
    wants(text, /մեկնում|հաջորդ|ամսաթիվ|երբ|departure/) ||
    wants(text, /տեղ|ազատ|seat/) ||
    wants(text, /ժամ/) ||
    wants(text, /որտեղ|վայր|շարժ/) ||
    wants(text, /ներառ/) ||
    wants(text, /այս շաբաթ/) ||
    wants(text, /կապ|հեռախոս|զանգ|phone/) ||
    wants(text, /ամբողջ ինֆոր|մանրամասն|ամբողջ ծրագիր/) ||
    wants(text, /կասես|կասեք|տեղեկացր|տեղեկացն|հայտնիր|հայտնեք|կհիշ|հիշիր|հիշեք|նախապես/) ||
    wants(text, /առաջիկա տուրեր|մեր ուղղությունները/)
  );
}

function asksFull(text: string) {
  return wants(text, /ամբողջ ինֆոր|մանրամասն|ամբողջ ծրագիր/);
}

function asksNotice(text: string) {
  return wants(text, /կասես|կասեք|տեղեկացր|տեղեկացն|հայտնիր|հայտնեք|կհիշ|հիշիր|հիշեք|նախապես/);
}

function isOnlyGreeting(text: string) {
  return /^(բարև|բարեւ|ողջույն|hello|hi|բարի լույս|բարի օր|բարի երեկո)( քեզ| ձեզ)?$/.test(
    normalize(text),
  );
}

function continuesOffer(text: string) {
  return /^(ասա|ասացիր|պատմիր|շարունակիր)( ինձ| էլի)?$/.test(normalize(text));
}

function uniqueTours(tours: PublicTourFact[]) {
  const seen = new Set<string>();
  return tours.filter((tour) => {
    if (seen.has(tour.id)) return false;
    seen.add(tour.id);
    return true;
  });
}

function latestShownTours(history: ChatTurn[] | undefined, tours: PublicTourFact[]) {
  const turns = history ?? [];
  let listFallback: PublicTourFact[] | null = null;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (!turn || turn.role !== "assistant") continue;
    const text = normalize(turn.text);
    if (
      text.includes("որ տուրի գինն") ||
      text.includes("հետաքրքրությունդ գրանցված") ||
      text.includes("արդեն գրանցված") ||
      text.includes("ընտրիր")
    )
      continue;
    const found = uniqueTours(mentioned(turn.text, tours));
    if (found.length === 0) continue;
    const previous = turns[index - 1];
    if (
      previous?.role === "user" &&
      /^(առաջիկա տուրեր|մեր ուղղությունները)$/.test(normalize(previous.text))
    ) {
      listFallback ??= found;
      continue;
    }
    return found;
  }
  return listFallback ?? [];
}

function awaitingPriceChoice(history: ChatTurn[] | undefined) {
  for (const turn of [...(history ?? [])].reverse()) {
    if (turn.role !== "assistant") continue;
    return normalize(turn.text).includes("որ տուրի գինն");
  }
  return false;
}

function latestUserTour(history: ChatTurn[] | undefined, tours: PublicTourFact[]) {
  const turns = [...(history ?? [])].reverse();
  for (const turn of turns) {
    if (turn.role !== "user") continue;
    const found = mentioned(turn.text, tours);
    if (found.length === 1) return found[0] ?? null;
    const regional = toursInRegion(turn.text, tours);
    if (regional.length === 1) return regional[0] ?? null;
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
  "գին",
  "գինը",
  "արժե",
  "արժի",
  "արժեն",
  "արժեք",
  "price",
  "սովորաբար",
  "սովորական",
  "դրամ",
  "ժամ",
  "ժամը",
  "մեկնում",
  "հաջորդ",
  "ամսաթիվ",
  "տեղ",
  "տեղը",
  "ազատ",
  "seat",
  "ասա",
  "ասացիր",
  "պատմիր",
  "շարունակիր",
  "տուր",
  "տուրը",
  "տուրեր",
  "տուրի",
  "ուզում",
  "եմ",
  "կա",
  "կան",
  "ինձ",
  "մասին",
  "որ",
  "որը",
  "ինչ",
  "ես",
  "ձեզ",
  "իսկ",
  "քանի",
  "քանիսն",
  "բարև",
  "տեղեկացրու",
  "տեղեկացրեք",
  "կասես",
  "կասեք",
  "ասես",
  "ասեք",
  "հայտնիր",
  "հայտնեք",
  "կհիշեմ",
  "կհիշես",
  "կհիշեք",
  "հիշիր",
  "հիշեք",
  "նախապես",
  "կարող",
  "տեղեկացնել",
  "տեղեկացնեմ",
  "համար",
  "հոգու",
  "հոգի",
  "երկու",
  "երկուս",
  "մեկ",
  "ամրագրի",
  "երբ",
  "լինի",
  "շաբաթ",
  "այս",
  "ունես",
  "ունեք",
  "ներառված",
  "ներառ",
  "ինչքան",
  "ինչքա",
  "որքան",
  "որքա",
  "ամբողջ",
  "ինֆորմացիան",
  "ինֆորմացիա",
  "մանրամասն",
  "ծրագիրը",
  "ծրագիր",
  "ուղղությունները",
  "ուղղությունը",
  "առաջիկա",
  "կապ",
  "հեռախոս",
  "հեռախոսահամար",
  "զանգ",
  "phone",
  "ամրագրել",
  "ամրագրիր",
  "ամրագր",
  "book",
  "բաց",
  "բացել",
  "էջը",
  "բայց",
  "եթե",
  "կլինի",
]);

export function unknownDirection(message: string, tours: PublicTourFact[]) {
  if (mentioned(message, tours).length > 0 || toursInRegion(message, tours).length > 0) return null;
  const tokens = message
    .replace(/[՞՛՝]/gu, "")
    .split(/[^\p{L}\p{N}-]+/u)
    .filter((token) => {
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
    reply:
      "Տուրերի հրապարակային տվյալները հիմա չբեռնվեցին։ Գին, ժամ կամ ազատ տեղերի թիվ չեմ նշում։",
    booking: null,
    interest: null,
    choices: null,
  };
}

function plain(reply: string, interest: InterestOffer | null = null): ChatAnswer {
  return { reply, booking: null, interest, choices: null };
}

function latestMissingDirection(history: ChatTurn[] | undefined, tours: PublicTourFact[]) {
  const turns = [...(history ?? [])].reverse();
  for (const turn of turns) {
    if (turn.role !== "user") continue;
    const text = repairTypos(turn.text);
    if (mentioned(text, tours).length > 0 || toursInRegion(text, tours).length > 0) continue;
    const found = unknownDirection(text, tours);
    if (found) return found.label;
  }
  return null;
}

function interestInvite(name: string, kind: "missing" | "closed") {
  const fact =
    kind === "missing"
      ? `${genitiveName(name)} ուղղությամբ այս պահին տուր չունենք։`
      : `${name} առաջիկա բաց մեկնում դեռ չկա։`;
  return `${fact} Ցանկանո՞ւմ ես գրանցել հետաքրքրությունդ`;
}

function alreadyRegisteredLine(name: string) {
  return `${genitiveName(name)} տուրի նկատմամբ հետաքրքրությունդ արդեն գրանցված է`;
}

function displayLabel(label: string) {
  const trimmed = label.trim();
  return trimmed.charAt(0).toLocaleUpperCase("hy") + trimmed.slice(1);
}

function missingDirectionReply(label: string): ChatAnswer {
  const shown = displayLabel(label);
  return {
    reply: interestInvite(shown, "missing"),
    booking: null,
    interest: { tourId: null, label: shown },
    choices: null,
  };
}

function closedDepartureReply(tour: PublicTourFact): ChatAnswer {
  return {
    reply: interestInvite(shortName(tour), "closed"),
    booking: null,
    interest: { tourId: tour.id, label: tour.title },
    choices: null,
  };
}

function regionMatchReply(
  matches: PublicTourFact[],
  now: Date,
  memory: { tourId: string | null; key: string }[],
): ChatAnswer {
  if (matches.length > 1) {
    return {
      reply: "Այդ մարզում մի քանի տուր կա։ Ընտրիր մեկը։",
      booking: null,
      interest: null,
      choices: matches.map((tour) => ({ id: tour.id, title: choiceLabel(tour) })),
    };
  }
  const tour = matches[0];
  if (!tour) return plain("Այդ մարզում հրապարակված տուր չկա։");
  const interest = visibleInterest(catalogInterest(tour, now), memory, shortName(tour));
  const invite = interest ? " Ցանկանո՞ւմ ես գրանցել հետաքրքրությունդ" : "";
  return {
    reply: `«${tour.title}»։ ${departureSentence(tour, now)}${invite}\n${pageLink(tour)}`,
    booking: null,
    interest,
    choices: null,
  };
}

export type ChatIntentName =
  | "price"
  | "departure"
  | "seats"
  | "place"
  | "included"
  | "contact"
  | "summary"
  | "full"
  | "notice"
  | "booking"
  | "greeting"
  | "upcoming"
  | "directions"
  | "unknown";

export type ChatReading = {
  intent: ChatIntentName;
  direction: string | null;
  party: number | null;
};

const CHAT_INTENTS = new Set<ChatIntentName>([
  "price",
  "departure",
  "seats",
  "place",
  "included",
  "contact",
  "summary",
  "full",
  "notice",
  "booking",
  "greeting",
  "upcoming",
  "directions",
  "unknown",
]);

export function chatIntentContext(history: ChatTurn[] | undefined, tours: PublicTourFact[]) {
  let direction: string | null = null;
  let tour: string | null = null;
  for (const turn of history ?? []) {
    if (turn.role !== "user") continue;
    const text = repairTypos(turn.text);
    const found = mentioned(text, tours);
    const resolved = found.length > 0 ? found : toursInRegion(text, tours);
    if (resolved.length === 1) {
      const selected = resolved[0];
      if (!selected) continue;
      tour = selected.title;
      direction = choiceLabel(selected);
      continue;
    }
    if (resolved.length > 1) continue;
    const missing = unknownDirection(text, tours);
    if (missing) direction = missing.label;
  }
  const shown = latestShownTours(history, tours);
  if (shown.length === 1 && shown[0]) {
    tour = shown[0].title;
    direction = choiceLabel(shown[0]);
  }
  return { direction, tour };
}

function readingFits(reading: ChatReading, message: string) {
  if (reading.intent === "greeting") return isOnlyGreeting(message);
  if (reading.intent === "upcoming") return wants(message, /^առաջիկա տուրեր$/);
  if (reading.intent === "directions") return wants(message, /^մեր ուղղությունները$/);
  return true;
}

function singleResolved(message: string, tours: PublicTourFact[]) {
  const named = mentioned(message, tours);
  if (named.length === 1) return named[0] ?? null;
  if (named.length > 1) return null;
  const regional = toursInRegion(message, tours);
  return regional.length === 1 ? (regional[0] ?? null) : null;
}

function partyFromReading(party: unknown, message: string) {
  if (typeof party !== "number" || !Number.isInteger(party) || party < 1 || party > 12) return null;
  const text = normalize(message);
  if (party === 2 && /երկու|երկուս/.test(text)) return 2;
  if (new RegExp(`(^|\\D)${party}(\\D|$)`).test(message)) return party;
  return null;
}

function directionIsAllowed(
  label: string,
  message: string,
  context: { direction: string | null; tour: string | null },
  tours: PublicTourFact[],
) {
  const key = normalize(label);
  if (key.length < 2 || key.length > 40) return false;
  const messageKey = normalize(message);
  if (messageKey.includes(key)) return true;
  const contextKeys = [context.direction, context.tour].flatMap((item) =>
    item ? [normalize(item)] : [],
  );
  if (contextKeys.some((item) => item === key || item.includes(key))) return true;
  return tours.some((tour) => {
    const title = normalize(tour.title);
    return (
      title === key || title.includes(key) || aliases(tour).some((name) => normalize(name) === key)
    );
  });
}

export function validatedChatReading(
  raw: unknown,
  message: string,
  context: { direction: string | null; tour: string | null },
  tours: PublicTourFact[],
): ChatReading | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const intent = record["intent"];
  if (typeof intent !== "string" || !CHAT_INTENTS.has(intent as ChatIntentName)) return null;
  if (intent === "booking" && !wantsBooking(message)) return null;
  const rawDirection =
    typeof record["direction"] === "string" ? record["direction"].trim().slice(0, 40) : "";
  const direction =
    rawDirection &&
    /^[\p{L}\s-]{2,40}$/u.test(rawDirection) &&
    directionIsAllowed(rawDirection, message, context, tours)
      ? rawDirection
      : null;
  const followUp =
    intent === "notice" ||
    intent === "price" ||
    intent === "departure" ||
    intent === "seats" ||
    intent === "place" ||
    intent === "included" ||
    intent === "contact" ||
    intent === "summary" ||
    intent === "full";
  const kept = direction ?? (followUp ? context.direction : null);
  return {
    intent: intent as ChatIntentName,
    direction: kept,
    party: partyFromReading(record["party"], message),
  };
}

function tourFromDirection(direction: string | null, tours: PublicTourFact[]) {
  if (!direction) return null;
  const found = mentioned(direction, tours);
  if (found.length === 1) return found[0] ?? null;
  const regional = toursInRegion(direction, tours);
  return regional.length === 1 ? (regional[0] ?? null) : null;
}

function remembered(
  memory: { tourId: string | null; key: string }[],
  offer: { tourId: string | null; label: string },
  short = "",
) {
  if (offer.tourId && memory.some((item) => item.tourId === offer.tourId)) return true;
  const keys = new Set(memory.map((item) => directionKey(item.key)));
  return keys.has(directionKey(offer.label)) || (short !== "" && keys.has(directionKey(short)));
}

function visibleInterest(
  offer: InterestOffer | null,
  memory: { tourId: string | null; key: string }[],
  short = "",
) {
  if (!offer || remembered(memory, offer, short)) return null;
  return offer;
}

function routePriceName(tour: PublicTourFact) {
  const key = normalize(tour.title);
  if (key.includes("գառնի") && key.includes("գեղարդ"))
    return { plain: "Գառնի–Գեղարդ", missing: "Գառնի–Գեղարդի" };
  const plainName = shortName(tour);
  return { plain: plainName, missing: genitiveName(plainName) };
}

function quotedPrice(
  tour: PublicTourFact,
  now: Date,
  memory: { tourId: string | null; key: string }[],
  future: boolean,
): ChatAnswer {
  const next = readDeparture(tour, now);
  if (!future && next.kind !== "soldout") return priceAnswer(tour, null, now, memory);
  const name = routePriceName(tour);
  const hasPrice = tour.price !== null && tour.price > 0;
  const line = !hasPrice
    ? `${name.missing} հաջորդ մեկնման գինը դեռ հրապարակված չէ։`
    : future
      ? `${name.plain} տուրի հրապարակված գինը մեկ անձի համար ${tour.price} դրամ է։ Հաջորդ մեկնման գինը կհաստատվի, երբ այն հրապարակվի։`
      : `${name.plain} տուրի հրապարակված գինը մեկ անձի համար ${tour.price} դրամ է։`;
  const withStatus = next.kind === "soldout" ? `${line} ${soldOutLine(tour, next.date)}` : line;
  const offer = next.kind === "open" ? null : { tourId: tour.id, label: tour.title };
  return plain(withStatus, future ? null : visibleInterest(offer, memory, shortName(tour)));
}

function priceAnswer(
  tour: PublicTourFact,
  party: number | null,
  now: Date,
  memory: { tourId: string | null; key: string }[],
): ChatAnswer {
  const price = groupPriceSentence(tour, party);
  const closed = readDeparture(tour, now).kind === "none";
  const offer = closed ? { tourId: tour.id, label: tour.title } : null;
  const reply = closed ? `${price} ${closedLine(tour)}` : `${price}\n${pageLink(tour)}`;
  return plain(reply, visibleInterest(offer, memory, shortName(tour)));
}

function latestDirection(history: ChatTurn[] | undefined, tours: PublicTourFact[]) {
  for (const turn of [...(history ?? [])].reverse()) {
    if (turn.role !== "user") continue;
    const text = repairTypos(turn.text);
    const found = mentioned(text, tours);
    if (found.length === 1) return { tour: found[0] ?? null, missing: null as string | null };
    const regional = toursInRegion(text, tours);
    if (regional.length === 1) return { tour: regional[0] ?? null, missing: null as string | null };
    const unknown = unknownDirection(text, tours);
    if (unknown) return { tour: null, missing: unknown.label };
  }
  return { tour: null, missing: null as string | null };
}

export function answerTourChat(input: {
  message: string;
  pageTourId?: string | null;
  facts: ChatFacts;
  now?: Date;
  history?: ChatTurn[];
  channel?: "live" | "mock" | "off";
  reading?: ChatReading | null;
  registered?: { tourId: string | null; key: string }[];
  shownTourIds?: string[];
}): ChatAnswer {
  const message = repairTypos(input.message.trim());
  const now = input.now ?? new Date();
  const channel = input.channel ?? "mock";
  if (!input.facts.ok) return unavailable();
  if (isOnlyGreeting(message)) {
    return plain(
      "Բարև՜ 👋 Որևէ ուղղություն մտքո՞ւմ ունես, թե՞ նայենք՝ ինչ տուրեր ունենք առաջիկայում",
    );
  }
  const tours = input.facts.tours;
  const memory = input.registered ?? [];
  if (!asksSomething(message) && !wantsBooking(message) && mentioned(message, tours).length === 0) {
    const regional = toursInRegion(message, tours);
    if (regional.length > 0) return regionMatchReply(regional, now, memory);
  }
  const reading =
    input.reading && input.reading.intent !== "unknown" && readingFits(input.reading, message)
      ? input.reading
      : null;
  if (reading?.intent === "greeting") {
    return plain(
      "Բարև՜ 👋 Որևէ ուղղություն մտքո՞ւմ ունես, թե՞ նայենք՝ ինչ տուրեր ունենք առաջիկայում",
    );
  }
  if (reading?.intent === "upcoming" || wants(message, /^առաջիկա տուրեր$/))
    return plain(upcomingReply(tours, now));
  if (reading?.intent === "directions" || wants(message, /^մեր ուղղությունները$/)) {
    if (tours.length === 0) return plain("Հրապարակված ուղղություն դեռ չկա։");
    return {
      reply: "Ընտրիր ուղղությունը։",
      booking: null,
      interest: null,
      choices: tours.map((tour) => ({ id: tour.id, title: choiceLabel(tour) })),
    };
  }
  const shownIds = new Set(input.shownTourIds ?? []);
  const buttonTours = tours.filter((tour) => shownIds.has(tour.id));
  const menuButtons = buttonTours.length > 1 && buttonTours.length >= tours.length;
  const contextTours =
    buttonTours.length > 0 && !menuButtons ? buttonTours : latestShownTours(input.history, tours);
  const namedNow = mentioned(message, tours);
  if (namedNow.length === 1 && namedNow[0] && awaitingPriceChoice(input.history)) {
    return quotedPrice(namedNow[0], now, memory, asksFuturePrice(message));
  }
  const priceOnly =
    (asksPrice(message) || asksFuturePrice(message)) &&
    !wants(message, /մեկնում|հաջորդ|ամսաթիվ|երբ|departure/) &&
    !wants(message, /տեղ|ազատ|seat/) &&
    !wants(message, /ժամ/) &&
    !wants(message, /որտեղ|վայր|շարժ/) &&
    !wants(message, /ներառ/);
  if (priceOnly && namedNow.length === 0) {
    if (contextTours.length > 1) return plain("Ո՞ր տուրի գինն ես ուզում իմանալ");
    if (contextTours.length === 1 && contextTours[0])
      return quotedPrice(contextTours[0], now, memory, asksFuturePrice(message));
  }
  if (reading) {
    const explicit = singleResolved(message, tours);
    const stray = explicit ? null : unknownDirection(message, tours);
    if (stray) return missingDirectionReply(displayLabel(stray.label));
    const selected = explicit ?? tourFromDirection(reading.direction, tours);
    if (reading.intent === "notice") {
      if (reading.direction && !selected) {
        const label = displayLabel(reading.direction);
        if (remembered(memory, { tourId: null, label })) return plain(alreadyRegisteredLine(label));
        return missingDirectionReply(label);
      }
      if (
        selected &&
        remembered(memory, { tourId: selected.id, label: selected.title }, shortName(selected))
      ) {
        return plain(alreadyRegisteredLine(shortName(selected)));
      }
      if (selected && catalogInterest(selected, now)) return closedDepartureReply(selected);
      if (selected)
        return plain(`${departureSentence(selected, now)}\n${pageLink(selected)}`, null);
    }
    if (reading.intent === "price") {
      if (
        selected &&
        (asksFuturePrice(message) || readDeparture(selected, now).kind === "soldout")
      ) {
        return quotedPrice(selected, now, memory, asksFuturePrice(message));
      }
      if (selected) return priceAnswer(selected, reading.party, now, memory);
      if (reading.direction) {
        const label = displayLabel(reading.direction);
        const offer = { tourId: null, label };
        return plain(unpublishedPrice(label), remembered(memory, offer) ? null : offer);
      }
    }
    if (reading.intent === "booking" && selected) {
      const offer = bookingOffer({
        tour: selected,
        tours,
        party: reading.party,
        now,
        cashbackPercent: input.facts.cashbackPercent ?? null,
      });
      if (offer.booking.departures.length === 0) {
        return {
          reply: unavailableBooking(selected, now),
          booking: offer.booking,
          interest: visibleInterest(catalogInterest(selected, now), memory, shortName(selected)),
          choices: null,
        };
      }
      return { ...offer, interest: null, choices: null };
    }
    if (
      selected &&
      (reading.intent === "departure" ||
        reading.intent === "seats" ||
        reading.intent === "place" ||
        reading.intent === "included" ||
        reading.intent === "contact" ||
        reading.intent === "summary" ||
        reading.intent === "full")
    ) {
      const interest = visibleInterest(catalogInterest(selected, now), memory, shortName(selected));
      if (reading.intent === "summary") return plain(summary(selected, now), interest);
      if (reading.intent === "full") return plain(fullProgram(selected, now), interest);
      const line =
        reading.intent === "departure"
          ? departureSentence(selected, now)
          : reading.intent === "seats"
            ? seatSentence(selected, now, reading.party)
            : reading.intent === "place"
              ? placeSentence(selected)
              : reading.intent === "included"
                ? includedSentence(selected)
                : contactSentence(selected);
      return plain(`${line}\n${pageLink(selected)}`, interest);
    }
  }
  const named = mentioned(message, tours);
  if (named.length > 1) {
    return {
      reply: "Մի քանի տուր է համընկնում։ Ընտրիր մեկը։",
      booking: null,
      interest: null,
      choices: named.map((tour) => ({ id: tour.id, title: choiceLabel(tour) })),
    };
  }
  const askedNotice = asksNotice(message);
  const missing = named.length === 0 ? unknownDirection(message, tours) : null;
  if (missing) {
    const label = displayLabel(missing.label);
    const offer = { tourId: null, label };
    const known = remembered(memory, offer);
    if (askedNotice && known) return plain(alreadyRegisteredLine(label));
    if (asksPrice(message) && !wantsBooking(message))
      return plain(unpublishedPrice(label), known ? null : offer);
    if (known) return plain(`${genitiveName(label)} ուղղությամբ այս պահին տուր չունենք։`);
    return missingDirectionReply(label);
  }
  if (named.length === 0 && askedNotice) {
    const last = latestDirection(input.history, tours);
    if (last.missing) {
      const label = displayLabel(last.missing);
      if (remembered(memory, { tourId: null, label })) return plain(alreadyRegisteredLine(label));
      const reply =
        channel === "live"
          ? interestInvite(label, "missing")
          : `${interestInvite(label, "missing")} Ավտոմատ ծանուցում այս պահին չի ուղարկվում։`;
      return { reply, booking: null, interest: { tourId: null, label }, choices: null };
    }
    if (
      last.tour &&
      remembered(memory, { tourId: last.tour.id, label: last.tour.title }, shortName(last.tour))
    ) {
      return plain(alreadyRegisteredLine(shortName(last.tour)));
    }
    if (last.tour && catalogInterest(last.tour, now)) {
      const reply =
        channel === "live"
          ? interestInvite(shortName(last.tour), "closed")
          : `${interestInvite(shortName(last.tour), "closed")} Ավտոմատ ծանուցում այս պահին չի ուղարկվում։`;
      return {
        reply,
        booking: null,
        interest: { tourId: last.tour.id, label: last.tour.title },
        choices: null,
      };
    }
  }
  if (asksFull(message) && named.length === 0) {
    const selected = latestUserTour(input.history, tours);
    const missing = latestMissingDirection(input.history, tours);
    if (selected && missing) {
      const lori = selected.id === "lori" || normalize(selected.title).includes("լոռի");
      const gyumri = normalize(missing) === "գյումրի";
      return {
        reply:
          lori && gyumri
            ? "Գյումրիի՞ մասին ես հարցնում, թե՞ Լոռու տուրի ամբողջ ծրագիրն ես ուզում տեսնել"
            : `${directionName(missing)}՞ մասին ես հարցնում, թե՞ ${choiceLabel(selected)} տուրի ամբողջ ծրագիրն ես ուզում տեսնել`,
        booking: null,
        interest: null,
        choices: [
          { id: `direction-${normalize(missing).replace(/\s+/g, "-")}`, title: missing },
          {
            id: selected.id,
            title:
              lori && gyumri
                ? "Լոռու տուրի ամբողջ ծրագիրը"
                : `${choiceLabel(selected)}՝ ամբողջ ծրագիրը`,
          },
        ],
      };
    }
  }
  const pageId = input.pageTourId && TOUR_ID.test(input.pageTourId) ? input.pageTourId : "";
  const tour =
    named[0] ??
    latestUserTour(input.history, tours) ??
    (pageId ? (tours.find((item) => item.id === pageId) ?? null) : null);
  if (wants(message, /այս շաբաթ/)) {
    return plain(weekReply(named.length === 1 && tour ? [tour] : tours, now));
  }
  if (wantsBooking(message)) {
    const offer = bookingOffer({
      tour,
      tours,
      party: partyFromMessage(message),
      now,
      cashbackPercent: input.facts.cashbackPercent ?? null,
    });
    if (tour && offer.booking.departures.length === 0) {
      return {
        reply: unavailableBooking(tour, now),
        booking: offer.booking,
        interest: visibleInterest(catalogInterest(tour, now), memory, shortName(tour)),
        choices: null,
      };
    }
    return { ...offer, interest: null, choices: null };
  }
  if (!tour) return plain(asksPrice(message) ? "Ո՞ր տուրի գինն ես ուզում իմանալ" : clarify(tours));
  if (asksFuturePrice(message) || (priceOnly && readDeparture(tour, now).kind === "soldout")) {
    return quotedPrice(tour, now, memory, asksFuturePrice(message));
  }
  const askPrice = asksPrice(message);
  const askDeparture = wants(message, /մեկնում|հաջորդ|ամսաթիվ|երբ|departure/);
  const askSeats = wants(message, /տեղ|ազատ|seat/);
  const askTime = wants(message, /ժամ/) && !wants(message, /այս շաբաթ/);
  const askPlace = wants(message, /որտեղ|վայր|շարժ/);
  const askIncluded = wants(message, /ներառ/);
  const askContact = wants(message, /կապ|հեռախոս|զանգ|phone/);
  const interest = visibleInterest(catalogInterest(tour, now), memory, shortName(tour));
  if (asksFull(message)) return plain(fullProgram(tour, now), interest);
  if (!asksSomething(message) && (named.length === 1 || continuesOffer(message))) {
    if (catalogInterest(tour, now) && !interest) return plain(closedLine(tour));
    if (interest) return closedDepartureReply(tour);
    return plain(summary(tour, now), null);
  }
  const party = partyFromMessage(message);
  const normalized = normalize(message);
  const onlyPrice = askPrice && !askDeparture && !askSeats;
  const priceLine =
    onlyPrice && readDeparture(tour, now).kind === "none"
      ? `${groupPriceSentence(tour, party)} ${closedLine(tour)}`
      : groupPriceSentence(tour, party);
  const pieces = [
    askPrice
      ? { at: normalized.search(/գին|արժե|արժի|արժեն|արժեք|կնստ|price|հոգ/), line: priceLine }
      : null,
    askPlace ? { at: normalized.search(/որտեղ|վայր|շարժ/), line: placeSentence(tour) } : null,
    askTime && !askDeparture && !askSeats
      ? { at: normalized.search(/ժամ/), line: timeSentence(tour, now) }
      : null,
    askIncluded ? { at: normalized.search(/ներառ/), line: includedSentence(tour) } : null,
    askContact
      ? { at: normalized.search(/կապ|հեռախոս|զանգ|phone/), line: contactSentence(tour) }
      : null,
    askSeats && !askDeparture
      ? { at: normalized.search(/տեղ|ազատ|seat/), line: seatSentence(tour, now, party) }
      : null,
    askDeparture
      ? {
          at: normalized.search(/մեկնում|հաջորդ|ամսաթիվ|երբ|departure/),
          line: departureSentence(tour, now),
        }
      : null,
  ].filter((item): item is { at: number; line: string } => item !== null);
  pieces.sort((left, right) => left.at - right.at);
  if (pieces.length === 0) {
    if (catalogInterest(tour, now) && !interest) return plain(closedLine(tour));
    if (interest) return closedDepartureReply(tour);
    return plain(summary(tour, now), null);
  }
  const body = pieces.map((item) => item.line).join(" ");
  return plain(`${body}\n${pageLink(tour)}`, interest);
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

export type ChatSection = "upcoming" | "directions" | "tour" | "booking";

export function openChatSection(input: {
  section: ChatSection;
  tourId?: string | null | undefined;
  facts: ChatFacts;
  now?: Date | undefined;
  registered?: { tourId: string | null; key: string }[] | undefined;
}): ChatAnswer {
  const now = input.now ?? new Date();
  if (!input.facts.ok) return catalogFailureReply();
  const tours = input.facts.tours;
  const memory = input.registered ?? [];
  if (input.section === "upcoming") return plain(upcomingReply(tours, now));
  if (input.section === "directions") {
    if (tours.length === 0) return plain("Հրապարակված ուղղություն դեռ չկա։");
    return {
      reply: "Ընտրիր ուղղությունը։",
      booking: null,
      interest: null,
      choices: tours.map((tour) => ({ id: tour.id, title: choiceLabel(tour) })),
    };
  }
  const tour = input.tourId ? (tours.find((item) => item.id === input.tourId) ?? null) : null;
  if (!tour) return plain("Այդ տուրը կատալոգում չկա։");
  if (input.section === "booking") {
    const offer = bookingOffer({
      tour,
      tours,
      party: null,
      now,
      cashbackPercent: input.facts.cashbackPercent ?? null,
    });
    return {
      reply: offer.reply,
      booking: offer.booking,
      interest:
        offer.booking.departures.length === 0
          ? visibleInterest(catalogInterest(tour, now), memory, shortName(tour))
          : null,
      choices: null,
    };
  }
  return plain(
    summary(tour, now),
    visibleInterest(catalogInterest(tour, now), memory, shortName(tour)),
  );
}

export function catalogFailureReply(): ChatAnswer {
  return {
    reply: "Տվյալները չհաջողվեց ստանալ։",
    booking: null,
    interest: null,
    choices: null,
  };
}

export function modelFailureReply(tours: PublicTourFact[]): ChatAnswer {
  return {
    reply: "Չաթը հիմա չկարողացավ պատասխանել։ Կարող ես բացել կատալոգը։",
    booking: null,
    interest: null,
    choices: tours.slice(0, 8).map((tour) => ({ id: tour.id, title: choiceLabel(tour) })),
  };
}

export function searchPublicTours(query: string, tours: PublicTourFact[]) {
  const text = repairTypos(query.trim());
  const merged = uniqueTours([...mentioned(text, tours), ...toursInRegion(text, tours)]);
  if (merged.length > 0) return merged;
  const normalized = normalize(text);
  if (normalized.length < 3) return [];
  return tours.filter((tour) =>
    aliases(tour).some(
      (name) => name.length >= 4 && (normalized.includes(name) || name.includes(normalized)),
    ),
  );
}

export function catalogSnapshot(tours: PublicTourFact[], now = new Date()) {
  return tours.slice(0, 30).map((tour) => ({
    id: tour.id,
    title: tour.title.slice(0, 120),
    location: tour.location?.slice(0, 80) ?? null,
    aliases: [...new Set([...aliases(tour), ...tourMarzes(tour)])].slice(0, 24),
    price: tour.price && tour.price > 0 ? tour.price : null,
    priceMissing: unpublishedPrice(shortName(tour)),
    departureLine: departureSentence(tour, now),
    seatLine: seatSentence(tour, now, null),
    programLine: fullProgram(tour, now).slice(0, 900),
    link: tourLink(tour),
  }));
}

export type ChatToolCall = {
  name:
    | "search_tours"
    | "get_program"
    | "get_price"
    | "get_departures"
    | "get_seats"
    | "suggest_action";
  tourId: string | null;
  party: number | null;
  query: string | null;
  action: "none" | "booking" | "interest" | "choices" | null;
};

const TOOL_NAMES = new Set<ChatToolCall["name"]>([
  "search_tours",
  "get_program",
  "get_price",
  "get_departures",
  "get_seats",
  "suggest_action",
]);

function toolFact(call: ChatToolCall, tours: PublicTourFact[], now: Date) {
  if (call.name === "search_tours") {
    const found = searchPublicTours(call.query ?? "", tours);
    return {
      text: found.map((tour) => `${tour.title}\n${pageLink(tour)}`).join("\n"),
      tours: found,
    };
  }
  if (call.name === "suggest_action") return { text: "", tours: [] as PublicTourFact[] };
  const tour = call.tourId ? (tours.find((item) => item.id === call.tourId) ?? null) : null;
  if (!tour) return { text: "", tours: [] as PublicTourFact[] };
  if (call.name === "get_price")
    return { text: groupPriceSentence(tour, call.party), tours: [tour] };
  if (call.name === "get_departures") return { text: departureSentence(tour, now), tours: [tour] };
  if (call.name === "get_seats")
    return { text: seatSentence(tour, now, call.party), tours: [tour] };
  return { text: fullProgram(tour, now), tours: [tour] };
}

export function groundChatAnswer(input: {
  reply: string;
  calls: ChatToolCall[];
  suggest: "none" | "booking" | "interest" | "choices";
  facts: ChatFacts;
  now?: Date | undefined;
  registered?: { tourId: string | null; key: string }[] | undefined;
}): ChatAnswer & { selectedTourId: string | null; grounded: boolean } {
  if (!input.facts.ok) return { ...catalogFailureReply(), selectedTourId: null, grounded: false };
  const now = input.now ?? new Date();
  const tours = input.facts.tours;
  const memory = input.registered ?? [];
  const calls = input.calls.filter((call) => TOOL_NAMES.has(call.name));
  const pieces = calls.map((call) => toolFact(call, tours, now));
  const factText = pieces.map((item) => item.text).join("\n");
  const usedTours = uniqueTours(pieces.flatMap((item) => item.tours));
  const reply = input.reply
    .replace(/\+?\d[\d\s-]{6,}\d/gu, "")
    .trim()
    .slice(0, 1200);
  const allowed = new Set(factText.match(/\d+/g) ?? []);
  const allowedLinks = new Set(factText.match(/\/tours\/[a-z0-9-]+/g) ?? []);
  const numbersOk = (reply.match(/\d+/g) ?? []).every((value) => allowed.has(value));
  const linksOk = (reply.match(/\/tours\/[a-z0-9-]+/g) ?? []).every((link) =>
    allowedLinks.has(link),
  );
  const priceCall = calls.find((call) => call.name === "get_price" && call.tourId);
  const priceTour = priceCall?.tourId
    ? (tours.find((item) => item.id === priceCall.tourId) ?? null)
    : null;
  const priceMissing = Boolean(priceTour && (priceTour.price === null || priceTour.price === 0));
  const departureCall = calls.find(
    (call) => (call.name === "get_departures" || call.name === "get_seats") && call.tourId,
  );
  const departureTour = departureCall?.tourId
    ? (tours.find((item) => item.id === departureCall.tourId) ?? null)
    : null;
  const closed = departureTour ? readDeparture(departureTour, now).kind === "none" : false;
  const natural =
    reply.length > 0 &&
    numbersOk &&
    linksOk &&
    (!priceMissing || reply.includes("դեռ հրապարակված չէ")) &&
    (!closed || reply.includes("բաց մեկնում դեռ չկա"));
  const onlySearch =
    calls.length > 0 &&
    calls.every((call) => call.name === "search_tours" || call.name === "suggest_action");
  let text = "";
  if (natural) text = reply;
  else if (onlySearch && usedTours.length > 1)
    text = "Այդ ուղղությամբ մի քանի տուր կա։ Ընտրիր մեկը։";
  else if (onlySearch && usedTours.length === 1 && usedTours[0]) text = summary(usedTours[0], now);
  else
    text = pieces
      .map((item) => item.text)
      .filter(Boolean)
      .join("\n");
  if (!text) return { ...modelFailureReply(tours), selectedTourId: null, grounded: false };
  const focus = usedTours.length === 1 ? (usedTours[0] ?? null) : null;
  if (focus && !text.includes(tourLink(focus))) text = `${text}\n${pageLink(focus)}`;
  if (focus && input.suggest === "booking") {
    const party = calls.find((call) => call.party)?.party ?? null;
    const offer = bookingOffer({
      tour: focus,
      tours,
      party,
      now,
      cashbackPercent: input.facts.cashbackPercent ?? null,
    });
    return {
      reply: text,
      booking: offer.booking,
      interest:
        offer.booking.departures.length === 0
          ? visibleInterest(catalogInterest(focus, now), memory, shortName(focus))
          : null,
      choices: null,
      selectedTourId: focus.id,
      grounded: true,
    };
  }
  if (usedTours.length > 1) {
    return {
      reply: text,
      booking: null,
      interest: null,
      choices: usedTours.map((tour) => ({ id: tour.id, title: choiceLabel(tour) })),
      selectedTourId: null,
      grounded: true,
    };
  }
  return {
    reply: text,
    booking: null,
    interest: focus ? visibleInterest(catalogInterest(focus, now), memory, shortName(focus)) : null,
    choices: null,
    selectedTourId: focus?.id ?? null,
    grounded: true,
  };
}
