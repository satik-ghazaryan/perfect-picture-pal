import { departureBookingClosed } from "./departure-deadline.ts";
import { tourMarzes, yerevanDateISO, type ChatFacts } from "./tour-chat-facts.ts";

export type VoiceDeparture = {
  date: string;
  weekday: string;
  seatsLeft: number | null;
};

export type VoiceTour = {
  title: string;
  regions: string[];
  priceAmd: number | null;
  departureTime: string | null;
  departurePlace: string | null;
  included: string[];
  upcoming: VoiceDeparture[];
};

export type VoiceToursPayload = {
  ok: boolean;
  today: string;
  tours: VoiceTour[];
  cashbackPercent: number | null;
  summary: string;
};

const WEEKDAYS_HY = [
  "կիրակի",
  "երկուշաբթի",
  "երեքշաբթի",
  "չորեքշաբթի",
  "հինգշաբթի",
  "ուրբաթ",
  "շաբաթ",
];
const MAX_DEPARTURES = 6;

function weekdayHy(date: string) {
  const parsed = new Date(`${date}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? "" : (WEEKDAYS_HY[parsed.getUTCDay()] ?? "");
}

function capitalize(word: string) {
  return word ? word.charAt(0).toLocaleUpperCase("hy") + word.slice(1) : word;
}

function seatsText(seats: number | null) {
  if (seats === null) return "տեղերի քանակը անհայտ է";
  if (seats === 0) return "տեղեր չկան";
  return `${seats} ազատ տեղ`;
}

/** Compact, read-only catalog for the phone agent: only departures still open for booking. */
export function voiceToursPayload(facts: ChatFacts, now = new Date()): VoiceToursPayload {
  const today = yerevanDateISO(now);
  if (!facts.ok) {
    return {
      ok: false,
      today,
      tours: [],
      cashbackPercent: null,
      summary: "Տուրերի տվյալները հիմա հասանելի չեն։",
    };
  }
  const tours: VoiceTour[] = facts.tours.map((tour) => {
    const upcoming = tour.departures
      .filter((item) => !departureBookingClosed(item.date, tour.departureTime ?? "", now))
      .sort((left, right) => left.date.localeCompare(right.date))
      .slice(0, MAX_DEPARTURES)
      .map((item) => ({ date: item.date, weekday: weekdayHy(item.date), seatsLeft: item.seats }));
    return {
      title: tour.title,
      regions: [...tourMarzes(tour)].map(capitalize).sort((a, b) => a.localeCompare(b, "hy")),
      priceAmd: tour.price && tour.price > 0 ? tour.price : null,
      departureTime: tour.departureTime,
      departurePlace: tour.departurePlace,
      included: tour.included,
      upcoming,
    };
  });
  const lines = tours.map((tour) => {
    const price = tour.priceAmd ? `${tour.priceAmd} դրամ` : "գինը ճշտել մենեջերից";
    const time = tour.departureTime ? `մեկնումը ${tour.departureTime}` : "մեկնման ժամը ճշտել";
    const dates = tour.upcoming.length
      ? tour.upcoming
          .map((item) => `${item.date} (${item.weekday}) — ${seatsText(item.seatsLeft)}`)
          .join("; ")
      : "առաջիկա մեկնումներ դեռ նշանակված չեն";
    const region = tour.regions.length ? ` (${tour.regions.join(", ")} մարզ)` : "";
    return `${tour.title}${region}: ${price}, ${time}. Ամսաթվեր՝ ${dates}`;
  });
  return {
    ok: true,
    today,
    tours,
    cashbackPercent: facts.cashbackPercent ?? null,
    summary: lines.length ? lines.join("\n") : "Այս պահին ակտիվ տուրեր չկան։",
  };
}
