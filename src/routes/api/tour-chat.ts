import { createFileRoute } from "@tanstack/react-router";
import { clientAddress, loadPublicTourFacts, rateLimitTourChat, replyToTourQuestion } from "@/lib/tour-chat.server";
import { checkDepartureBooking, confirmPreviewFixture, isolatedBookingChecks, previewFixtureOffer, type BookingLive } from "@/lib/tour-chat-booking";
import { createInterestStore, interestDeliveryPlan, interestOfferEnabled, interestPreviewScenario, publishInterestDeparture, registerInterest } from "@/lib/tour-interest";
import type { ChatTurn } from "@/lib/tour-chat-facts";

const TOUR_ID = /^[a-z0-9-]{1,64}$/;
const MAX_BODY = 8_000;
const interestStore = createInterestStore();

function json(status: number, body: Record<string, unknown>) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function readHistory(value: unknown): ChatTurn[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-6).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const role = record["role"] === "assistant" ? "assistant" : record["role"] === "user" ? "user" : null;
    const text = typeof record["text"] === "string" ? record["text"].trim().slice(0, 500) : "";
    if (!role || !text) return [];
    return [{ role, text }];
  });
}

async function handlePost({ request }: { request: Request }) {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_BODY) return json(413, { error: "Հարցը չափազանց երկար է։" });
  let raw = "";
  try {
    raw = await request.text();
  } catch {
    return json(422, { error: "Հարցը չհաջողվեց կարդալ։" });
  }
  if (raw.length > MAX_BODY) return json(413, { error: "Հարցը չափազանց երկար է։" });
  let parsed: unknown;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    return json(422, { error: "Հարցը չհաջողվեց կարդալ։" });
  }
  if (!parsed || typeof parsed !== "object") return json(422, { error: "Հարցը թերի է։" });
  const record = parsed as Record<string, unknown>;
  const interestPhone = typeof record["phone"] === "string" ? record["phone"] : "";
  const interestConsent = record["consent"] === true;
  const interestDirection = typeof record["direction"] === "string" ? record["direction"].trim().slice(0, 80) : "";
  const interestTourId = typeof record["interestTourId"] === "string" ? record["interestTourId"].trim() : "";
  delete record["name"];
  delete record["phone"];
  delete record["passengerName"];
  const message = typeof record["message"] === "string" ? record["message"].trim() : "";
  const pageTourId = typeof record["tourId"] === "string" ? record["tourId"].trim() : "";
  if (pageTourId && !TOUR_ID.test(pageTourId)) return json(422, { error: "Տուրի էջը չճանաչվեց։" });
  if (!rateLimitTourChat(clientAddress(request))) {
    return json(429, { error: "Շատ հարց եկավ կարճ ժամանակում։ Մի րոպե հետո նորից փորձեք։ Ամրագրումը էջում բաց է մնում։" });
  }
  if (record["action"] === "interest-preview") {
    if (process.env.VERCEL_ENV === "production") return json(404, { error: "Չկա։" });
    const scenario = interestPreviewScenario();
    return json(200, {
      unknown: scenario.loriNotified === false,
      registered: scenario.registered,
      duplicate: scenario.duplicate,
      rows: scenario.rows,
      notices: scenario.notices,
      repeatNotices: scenario.repeatNotices,
      declined: scenario.declined,
      hasDate: scenario.body.includes("20 դեկտեմբեր 2026"),
      hasTime: scenario.body.includes("08:30"),
      hasLink: scenario.body.includes("/tours/garni"),
      delivery: scenario.delivery,
    });
  }
  if (record["action"] === "interest-register") {
    if (!interestOfferEnabled()) return json(200, { ok: false, message: "Ծանուցման ալիքը միացված չէ։" });
    const saved = registerInterest(interestStore, {
      label: interestDirection,
      tourId: interestTourId && TOUR_ID.test(interestTourId) ? interestTourId : null,
      phone: interestPhone,
      consent: interestConsent,
    });
    if (!saved.ok) return json(200, { ok: false, message: saved.message });
    return json(200, { ok: true, repeated: saved.repeated, delivery: interestDeliveryPlan() });
  }
  if (record["action"] === "interest-publish") {
    if (process.env.VERCEL_ENV === "production") return json(404, { error: "Չկա։" });
    const departureId = typeof record["departureId"] === "string" ? record["departureId"] : "";
    const dateLabel = typeof record["dateLabel"] === "string" ? record["dateLabel"].slice(0, 40) : "";
    const time = typeof record["time"] === "string" ? record["time"].slice(0, 5) : "";
    const label = typeof record["label"] === "string" ? record["label"].slice(0, 80) : "";
    const link = TOUR_ID.test(pageTourId) ? `/tours/${pageTourId}` : "";
    const created = publishInterestDeparture(interestStore, {
      tourId: pageTourId,
      label,
      dateLabel,
      time: time || null,
      departureId,
      link,
    });
    const delivery = interestDeliveryPlan();
    return json(200, {
      created: created.length,
      delivery,
      sample: created[0]?.body ?? "",
    });
  }
  if (record["action"] === "isolated-booking") {
    if (process.env.VERCEL_ENV === "production") return json(404, { error: "Չկա։" });
    return json(200, { isolated: isolatedBookingChecks() });
  }
  if (record["action"] === "isolated-confirm") {
    if (process.env.VERCEL_ENV === "production") return json(404, { error: "Չկա։" });
    const adults = typeof record["adults"] === "number" ? record["adults"] : 0;
    const children = typeof record["children"] === "number" ? record["children"] : 0;
    return json(200, {
      check: confirmPreviewFixture({
        departureId: typeof record["departureId"] === "string" ? record["departureId"] : "",
        party: adults + children,
        key: typeof record["key"] === "string" ? record["key"] : "",
        proof: typeof record["proof"] === "string" ? record["proof"] : "",
        expectedPrice: typeof record["expectedPrice"] === "number" ? record["expectedPrice"] : -1,
        expectedSeats: typeof record["expectedSeats"] === "number" ? record["expectedSeats"] : -1,
        expectedDate: typeof record["expectedDate"] === "string" ? record["expectedDate"] : "",
        expectedCashback: typeof record["expectedCashback"] === "number" ? record["expectedCashback"] : -1,
      }),
    });
  }
  if (record["action"] === "booking-check") {
    const facts = await loadPublicTourFacts();
    const tourId = pageTourId;
    const departureId = typeof record["departureId"] === "string" ? record["departureId"] : "";
    const adults = typeof record["adults"] === "number" ? record["adults"] : 0;
    const children = typeof record["children"] === "number" ? record["children"] : 0;
    const expectedPrice = typeof record["expectedPrice"] === "number" ? record["expectedPrice"] : -1;
    const expectedSeats = typeof record["expectedSeats"] === "number" ? record["expectedSeats"] : -1;
    const expectedDate = typeof record["expectedDate"] === "string" ? record["expectedDate"] : "";
    const expectedCashback = typeof record["expectedCashback"] === "number" ? record["expectedCashback"] : -1;
    const tour = facts.tours.find((item) => item.id === tourId);
    const row = tour?.departures.find((item) => item.id === departureId);
    if (!facts.ok || !tour || !row || row.seats === null || facts.cashbackPercent == null) {
      return json(200, { ok: false, code: "missing", message: "Մեկնման տվյալները չբեռնվեցին։ Թիվ չեմ նշում։" });
    }
    const live: BookingLive = {
      id: row.id,
      tourId: tour.id,
      date: row.date,
      time: tour.departureTime,
      place: tour.departurePlace,
      price: tour.price,
      seats: row.seats,
      cashbackPercent: facts.cashbackPercent,
    };
    return json(200, {
      check: checkDepartureBooking(
        {
          date: expectedDate,
          price: expectedPrice,
          seats: expectedSeats,
          cashbackPercent: expectedCashback,
          party: adults + children,
        },
        live,
      ),
    });
  }
  if (message.length < 1 || message.length > 500) return json(422, { error: "Գրեք մինչև 500 նիշանոց հարց։" });
  try {
    if (process.env.VERCEL_ENV !== "production" && message.toLocaleLowerCase("hy").includes("թեստային ամրագրում")) {
      const fixture = previewFixtureOffer();
      return json(200, { reply: fixture.reply, booking: fixture.booking });
    }
    const answer = await replyToTourQuestion({
      message,
      pageTourId: pageTourId || null,
      history: readHistory(record["history"]),
    });
    const delivery = interestDeliveryPlan();
    const interest = interestOfferEnabled() ? answer.interest : null;
    return json(200, { reply: answer.reply, booking: answer.booking, interest, notify: interest ? delivery.mode : "off" });
  } catch {
    return json(200, {
      reply: "Չաթը հիմա չկարողացավ պատասխանել։ Գին, ժամ կամ տեղերի թիվ չեմ նշում։ Ամրագրումը տուրի էջում շարունակվում է։",
    });
  }
}

function rejected() {
  return json(405, { error: "Այս հարցումը չաթի համար չէ։" });
}

export const Route = createFileRoute("/api/tour-chat")({
  server: {
    handlers: {
      POST: handlePost,
      GET: async () => rejected(),
      PUT: async () => rejected(),
      PATCH: async () => rejected(),
      DELETE: async () => rejected(),
    },
  },
});
