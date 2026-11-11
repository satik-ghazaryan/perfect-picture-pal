import { createClient } from "@supabase/supabase-js";
import {
  answerTourChat,
  chatIntentContext,
  publicFactsFromRows,
  replyKeepsPublishedFacts,
  validatedChatReading,
  type ChatAnswer,
  type ChatFacts,
  type ChatReading,
  type ChatTurn,
  type PublicTourFact,
} from "./tour-chat-facts.ts";
import { interestDeliveryPlan, interestOfferEnabled } from "./tour-interest.ts";

const WINDOW_MS = 60_000;
const LIMIT = 8;
const hits = new Map<string, number[]>();

function envValue(name: string) {
  const fromProcess = typeof process !== "undefined" ? process.env?.[name] : undefined;
  if (typeof fromProcess === "string" && fromProcess.trim()) return fromProcess.trim();
  const fromVite = import.meta.env?.[name];
  return typeof fromVite === "string" ? fromVite.trim() : "";
}

export function resetTourChatRateLimit() {
  hits.clear();
}

export function rateLimitTourChat(key: string, now = Date.now()) {
  const recent = (hits.get(key) ?? []).filter((time) => time > now - WINDOW_MS);
  if (recent.length >= LIMIT) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  return true;
}

export function anonCatalogKey(key: string) {
  const part = key.split(".")[1];
  if (!part) return false;
  try {
    const padded = part.replace(/-/g, "+").replace(/_/g, "/");
    const pad = padded + "=".repeat((4 - (padded.length % 4)) % 4);
    const payload = JSON.parse(atob(pad)) as { role?: string };
    return payload.role === "anon";
  } catch {
    return false;
  }
}
export function clientAddress(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  const candidate = forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
  return /^[A-Za-z0-9.:-]{1,80}$/.test(candidate) ? candidate : "unknown";
}

export async function loadPublicTourFacts(): Promise<ChatFacts> {
  const url = envValue("VITE_SUPABASE_URL") || envValue("SUPABASE_URL");
  const anonKey = envValue("VITE_SUPABASE_ANON_KEY") || envValue("SUPABASE_ANON_KEY");
  if (!url || !anonKey || !anonCatalogKey(anonKey)) return { ok: false, tours: [] };
  try {
    const client = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const [tours, departures, settings] = await Promise.all([
      client.from("tours").select("id,title_hy,price,departure_time,departure_place,highlights,included,excluded,is_virtual_only"),
      client.from("departures").select("id,tour_id,departure_date,available_seats"),
      client.from("site_settings").select("cashback_percent").eq("id", 1).maybeSingle(),
    ]);
    if (tours.error || departures.error) return { ok: false, tours: [] };
    const facts = publicFactsFromRows(tours.data, departures.data);
    const cashback = settings.data?.cashback_percent;
    facts.cashbackPercent = typeof cashback === "number" && Number.isInteger(cashback) && cashback >= 0 ? cashback : null;
    return facts;
  } catch {
    return { ok: false, tours: [] };
  }
}

function withoutPrivateNumbers(text: string) {
  return text.replace(/\+?\d[\d\s-]{6,}\d/gu, " ").replace(/\s+/g, " ").trim().slice(0, 500);
}

export async function classifyChatIntent(input: {
  message: string;
  direction: string | null;
  tour: string | null;
  tours: PublicTourFact[];
  requestId?: string | null;
}): Promise<ChatReading | null> {
  const base = envValue("PYTHON_BACKEND_URL").replace(/\/$/, "");
  const secret = envValue("CHAT_INTENT_API_SECRET");
  const question = withoutPrivateNumbers(input.message);
  if (!base || secret.length < 16 || !question) return null;
  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch {
    return null;
  }
  const loopback = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) return null;
  const requestId = (input.requestId ?? "").trim();
  const safeId = /^[A-Za-z0-9_.:-]{1,120}$/.test(requestId) ? requestId : "";
  try {
    const response = await fetch(`${parsed.origin}/api/chat-intent`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-secret": secret,
        ...(safeId ? { "x-request-id": safeId } : {}),
      },
      body: JSON.stringify({
        message: question,
        direction: input.direction?.slice(0, 80) ?? null,
        tour: input.tour?.slice(0, 80) ?? null,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    return validatedChatReading(await response.json(), input.message, {
      direction: input.direction,
      tour: input.tour,
    }, input.tours);
  } catch {
    return null;
  }
}

async function phraseFromServerModel(grounded: string) {
  const key = envValue("OPENAI_API_KEY");
  if (!key) return grounded;
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: envValue("OPENAI_MODEL") || "gpt-4o-mini",
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              "Վերաշարադրիր տրված հայերեն պատասխանը կարճ և պարզ։ Պահպանիր միայն այդտեղ արդեն եղած գինը, ամսաթիվը, ժամը, տեղերի թիվը և տուրի հղումը։ Նոր թիվ մի ավելացրու։ Ամրագրում կամ վճարում մի առաջարկիր։",
          },
          { role: "user", content: grounded },
        ],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return grounded;
    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = payload.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text || text.length > 1200 || !replyKeepsPublishedFacts(grounded, text)) return grounded;
    return text;
  } catch {
    return grounded;
  }
}

export async function replyToTourQuestion(input: {
  message: string;
  pageTourId?: string | null;
  history?: ChatTurn[];
  registered?: { tourId: string | null; key: string }[];
  shownTourIds?: string[];
  now?: Date;
  facts?: ChatFacts;
  channel?: "live" | "mock" | "off";
  requestId?: string | null;
}): Promise<ChatAnswer & { understood: "openai" | "rules" }> {
  const facts = input.facts ?? (await loadPublicTourFacts());
  const channel = input.channel ?? (interestOfferEnabled() ? interestDeliveryPlan().mode : "off");
  const context = facts.ok ? chatIntentContext(input.history, facts.tours) : { direction: null, tour: null };
  const reading = await classifyChatIntent({
    message: input.message,
    direction: context.direction,
    tour: context.tour,
    tours: facts.tours,
    requestId: input.requestId,
  });
  const grounded = answerTourChat({
    message: input.message,
    pageTourId: input.pageTourId,
    history: input.history,
    registered: input.registered,
    shownTourIds: input.shownTourIds,
    now: input.now,
    facts,
    channel,
    reading,
  });
  if (reading || grounded.booking || grounded.interest || grounded.choices?.length) {
    return { ...grounded, understood: reading ? "openai" : "rules" };
  }
  return {
    reply: await phraseFromServerModel(grounded.reply),
    booking: null,
    interest: null,
    choices: null,
    understood: "rules",
  };
}
