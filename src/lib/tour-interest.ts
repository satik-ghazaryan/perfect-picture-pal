import { validGuestPhone } from "./tour-chat-booking.ts";

export type InterestOffer = {
  tourId: string | null;
  label: string;
};

export type InterestRecord = {
  id: string;
  directionKey: string;
  label: string;
  tourId: string | null;
  phone: string;
  notified: string[];
};

export type InterestNotice = {
  interestId: string;
  departureId: string;
  body: string;
  phone: string;
};

export type InterestStore = {
  rows: InterestRecord[];
  notices: InterestNotice[];
};

export function createInterestStore(): InterestStore {
  return { rows: [], notices: [] };
}

export function directionKey(label: string) {
  return label.toLocaleLowerCase("hy").replace(/\s+/g, " ").trim();
}

export function registerInterest(
  store: InterestStore,
  input: { label: string; tourId: string | null; phone: string; consent: boolean },
) {
  const label = input.label.trim().slice(0, 80);
  const key = directionKey(label);
  if (!input.consent) return { ok: false as const, code: "consent", message: "Ծանուցման համաձայնությունը պարտադիր է։" };
  if (key.length < 2) return { ok: false as const, code: "direction", message: "Գրեք ուղղությունը։" };
  if (!validGuestPhone(input.phone)) return { ok: false as const, code: "phone", message: "Հեռախոսը պետք է ունենա 8–15 թվանշան։" };
  const phone = input.phone.replace(/\D/g, "");
  const existing = store.rows.find((row) => row.directionKey === key && row.phone === phone);
  if (existing) return { ok: true as const, repeated: true, id: existing.id };
  const row: InterestRecord = {
    id: `interest-${store.rows.length + 1}`,
    directionKey: key,
    label,
    tourId: input.tourId,
    phone,
    notified: [],
  };
  store.rows.push(row);
  return { ok: true as const, repeated: false, id: row.id };
}

export function interestMessage(input: { label: string; dateLabel: string; time: string | null; link: string }) {
  const time = input.time ? `Ժամը՝ ${input.time}` : "Ժամը նշված չէ։";
  return [`Արի Գնանք`, `«${input.label}» ուղղությամբ բաց մեկնում կա։`, `Ամսաթիվ՝ ${input.dateLabel}`, time, `Տուրի էջ՝ ${input.link}`].join("\n");
}

export function publishInterestDeparture(
  store: InterestStore,
  input: { tourId: string; label: string; dateLabel: string; time: string | null; departureId: string; link: string },
) {
  const key = directionKey(input.label);
  const created: InterestNotice[] = [];
  for (const row of store.rows) {
    const matches = row.tourId === input.tourId || row.directionKey === key;
    if (!matches) continue;
    if (row.notified.includes(input.departureId)) continue;
    row.notified.push(input.departureId);
    const notice = {
      interestId: row.id,
      departureId: input.departureId,
      phone: row.phone,
      body: interestMessage({ label: row.label, dateLabel: input.dateLabel, time: input.time, link: input.link }),
    };
    store.notices.push(notice);
    created.push(notice);
  }
  return created;
}

export function sameInterest(
  registered: { key: string; tourId: string | null }[],
  offer: { label: string; tourId: string | null },
) {
  const key = directionKey(offer.label);
  return registered.some((item) => item.key === key || (offer.tourId !== null && item.tourId === offer.tourId));
}

export function interestOfferEnabled(env: Record<string, string | undefined> = process.env, vercelEnv = env["VERCEL_ENV"]) {
  if (vercelEnv === "production" && interestDeliveryPlan(env).mode !== "live") return false;
  return true;
}

export function interestDeliveryPlan(env: Record<string, string | undefined> = process.env) {
  const webhook = Boolean(env["SMS_GATEWAY_URL"] || env["WHATSAPP_GATEWAY_URL"]);
  const twilio = Boolean(env["TWILIO_ACCOUNT_SID"] && env["TWILIO_AUTH_TOKEN"] && env["TWILIO_PHONE_NUMBER"]);
  if (webhook || twilio) return { mode: "live" as const, missing: [] as string[] };
  return {
    mode: "mock" as const,
    missing: ["SMS_GATEWAY_URL կամ WHATSAPP_GATEWAY_URL", "TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN և TWILIO_PHONE_NUMBER"],
  };
}

export function interestPreviewScenario() {
  const store = createInterestStore();
  const phone = "37491000000";
  const declined = registerInterest(store, { label: "Լոռի", tourId: null, phone, consent: false });
  const lori = registerInterest(store, { label: "Լոռի", tourId: null, phone, consent: true });
  const loriAgain = registerInterest(store, { label: "լոռի", tourId: null, phone, consent: true });
  const garni = registerInterest(store, { label: "Գառնի", tourId: "garni", phone, consent: true });
  const first = publishInterestDeparture(store, {
    tourId: "garni",
    label: "Գառնի",
    dateLabel: "20 դեկտեմբեր 2026",
    time: "08:30",
    departureId: "garni-open-1",
    link: "/tours/garni",
  });
  const second = publishInterestDeparture(store, {
    tourId: "garni",
    label: "Գառնի",
    dateLabel: "20 դեկտեմբեր 2026",
    time: "08:30",
    departureId: "garni-open-1",
    link: "/tours/garni",
  });
  return {
    declined: declined.ok,
    registered: lori.ok && garni.ok,
    duplicate: loriAgain.ok && loriAgain.repeated,
    rows: store.rows.length,
    notices: first.length,
    repeatNotices: second.length,
    loriNotified: first.some((notice) => notice.body.includes("Լոռի")),
    body: first[0]?.body ?? "",
    delivery: interestDeliveryPlan(),
  };
}
