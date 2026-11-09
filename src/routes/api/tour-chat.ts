import { createFileRoute } from "@tanstack/react-router";
import { clientAddress, rateLimitTourChat, replyToTourQuestion } from "@/lib/tour-chat.server";
import type { ChatTurn } from "@/lib/tour-chat-facts";

const TOUR_ID = /^[a-z0-9-]{1,64}$/;
const MAX_BODY = 8_000;

function json(status: number, body: { reply?: string; error?: string }) {
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
  const message = typeof record["message"] === "string" ? record["message"].trim() : "";
  const pageTourId = typeof record["tourId"] === "string" ? record["tourId"].trim() : "";
  if (message.length < 1 || message.length > 500) return json(422, { error: "Գրեք մինչև 500 նիշանոց հարց։" });
  if (pageTourId && !TOUR_ID.test(pageTourId)) return json(422, { error: "Տուրի էջը չճանաչվեց։" });
  if (!rateLimitTourChat(clientAddress(request))) {
    return json(429, { error: "Շատ հարց եկավ կարճ ժամանակում։ Մի րոպե հետո նորից փորձեք։ Ամրագրումը էջում բաց է մնում։" });
  }
  try {
    const reply = await replyToTourQuestion({
      message,
      pageTourId: pageTourId || null,
      history: readHistory(record["history"]),
    });
    return json(200, { reply });
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
