import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  catalogFailureReply,
  catalogSnapshot,
  groundChatAnswer,
  modelFailureReply,
  openChatSection,
  publicFactsFromRows,
  validatedChatReading,
  type ChatAnswer,
  type ChatFacts,
  type ChatReading,
  type ChatSection,
  type ChatToolCall,
  type ChatTurn,
  type PublicTourFact,
} from "./tour-chat-facts.ts";

/** How many earlier messages the model sees. Fewer than this and follow-up questions lose their subject. */
export const HISTORY_TURNS = 16;
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
function sameSecret(given: string, expected: string) {
  const incoming = Buffer.from(given);
  const wanted = Buffer.from(expected);
  if (incoming.length !== wanted.length || wanted.length < 16) {
    timingSafeEqual(wanted, wanted);
    return false;
  }
  return timingSafeEqual(incoming, wanted);
}

export function telegramRateKey(request: Request) {
  if (request.headers.get("x-chat-client") !== "telegram") return null;
  const expected = envValue("CHAT_INTENT_API_SECRET");
  const given = request.headers.get("x-api-secret") ?? "";
  if (!sameSecret(given, expected)) return null;
  const chatId = request.headers.get("x-chat-id") ?? "";
  return /^[0-9]{1,20}$/.test(chatId) ? `telegram:${chatId}` : null;
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
      client
        .from("tours")
        .select(
          "id,title_hy,price,departure_time,departure_place,highlights,included,excluded,is_virtual_only,location_hy,region",
        ),
      client.from("departures").select("id,tour_id,departure_date,available_seats"),
      client.from("site_settings").select("cashback_percent").eq("id", 1).maybeSingle(),
    ]);
    if (tours.error || departures.error) return { ok: false, tours: [] };
    const facts = publicFactsFromRows(tours.data, departures.data);
    const cashback = settings.data?.cashback_percent;
    facts.cashbackPercent =
      typeof cashback === "number" && Number.isInteger(cashback) && cashback >= 0 ? cashback : null;
    return facts;
  } catch {
    return { ok: false, tours: [] };
  }
}

function withoutPrivateNumbers(text: string) {
  return text
    .replace(/\+?\d[\d\s-]{6,}\d/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

export async function classifyChatIntent(input: {
  message: string;
  direction: string | null;
  tour: string | null;
  tours: PublicTourFact[];
  requestId?: string | null;
  skipModel?: boolean;
}): Promise<ChatReading | null> {
  if (input.skipModel) return null;
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
    return validatedChatReading(
      await response.json(),
      input.message,
      {
        direction: input.direction,
        tour: input.tour,
      },
      input.tours,
    );
  } catch {
    return null;
  }
}

function selectedTour(facts: ChatFacts, selectedTourId: string | null, pageTourId: string | null) {
  const id = selectedTourId || pageTourId || "";
  return facts.tours.find((tour) => tour.id === id) ?? null;
}

function readToolCalls(value: unknown): ChatToolCall[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const name = record["name"];
    if (
      name !== "search_tours" &&
      name !== "get_program" &&
      name !== "get_price" &&
      name !== "get_departures" &&
      name !== "get_seats" &&
      name !== "suggest_action"
    )
      return [];
    const tourId =
      typeof record["tourId"] === "string" && /^[a-z0-9-]{1,64}$/.test(record["tourId"])
        ? record["tourId"]
        : null;
    const party =
      typeof record["party"] === "number" &&
      Number.isInteger(record["party"]) &&
      record["party"] >= 1 &&
      record["party"] <= 12
        ? record["party"]
        : null;
    const query = typeof record["query"] === "string" ? record["query"].slice(0, 80) : null;
    const action =
      record["action"] === "booking" ||
      record["action"] === "interest" ||
      record["action"] === "choices" ||
      record["action"] === "none"
        ? record["action"]
        : null;
    return [{ name, tourId, party, query, action }];
  });
}

export async function answerChatWithTools(input: {
  message: string;
  history?: ChatTurn[] | undefined;
  selectedTourId?: string | null | undefined;
  facts: ChatFacts;
  now?: Date | undefined;
  requestId?: string | null | undefined;
  skipModel?: boolean | undefined;
}): Promise<{
  reply: string;
  calls: ChatToolCall[];
  suggest: "none" | "booking" | "interest" | "choices";
} | null> {
  if (input.skipModel || !input.facts.ok) return null;
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
  const now = input.now ?? new Date();
  const history = (input.history ?? []).slice(-HISTORY_TURNS).flatMap((turn) => {
    const text = withoutPrivateNumbers(turn.text);
    if (!text || (turn.role !== "user" && turn.role !== "assistant")) return [];
    return [{ role: turn.role, text }];
  });
  const ask = (turns: typeof history) =>
    fetch(`${parsed.origin}/api/chat-answer`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-secret": secret,
        ...(safeId ? { "x-request-id": safeId } : {}),
      },
      body: JSON.stringify({
        message: question,
        history: turns,
        selectedTourId: input.selectedTourId,
        tours: catalogSnapshot(input.facts.tours, now),
      }),
      signal: AbortSignal.timeout(20000),
    });
  try {
    let response = await ask(history);
    // An older backend accepts at most 8 turns and answers 422 to more. Keep the chat working.
    if (response.status === 422 && history.length > 8) response = await ask(history.slice(-8));
    if (!response.ok) return null;
    const payload = (await response.json()) as Record<string, unknown>;
    const reply = typeof payload["reply"] === "string" ? payload["reply"].slice(0, 1200) : "";
    const suggest =
      payload["suggest"] === "booking" ||
      payload["suggest"] === "interest" ||
      payload["suggest"] === "choices"
        ? payload["suggest"]
        : "none";
    return { reply, calls: readToolCalls(payload["calls"]), suggest };
  } catch {
    return null;
  }
}

export async function replyToTourQuestion(input: {
  message: string;
  pageTourId?: string | null;
  selectedTourId?: string | null;
  history?: ChatTurn[];
  registered?: { tourId: string | null; key: string }[];
  shownTourIds?: string[];
  now?: Date;
  facts?: ChatFacts;
  channel?: "live" | "mock" | "off";
  requestId?: string | null;
  skipModel?: boolean;
  section?: ChatSection | null;
}): Promise<ChatAnswer & { understood: "openai" | "rules"; selectedTourId: string | null }> {
  const facts = input.facts ?? (await loadPublicTourFacts());
  if (input.section) {
    const opened = openChatSection({
      section: input.section,
      tourId: input.selectedTourId ?? input.pageTourId,
      facts,
      now: input.now,
      registered: input.registered,
    });
    return {
      ...opened,
      understood: "rules",
      selectedTourId: input.selectedTourId ?? input.pageTourId ?? null,
    };
  }
  if (!facts.ok) return { ...catalogFailureReply(), understood: "rules", selectedTourId: null };
  const pageTour = selectedTour(facts, input.selectedTourId ?? null, input.pageTourId ?? null);
  const model = await answerChatWithTools({
    message: input.message,
    history: input.history,
    selectedTourId: pageTour?.id ?? null,
    facts,
    now: input.now,
    requestId: input.requestId,
    skipModel: input.skipModel,
  });
  if (!model)
    return {
      ...modelFailureReply(facts.tours),
      understood: "rules",
      selectedTourId: pageTour?.id ?? null,
    };
  const grounded = groundChatAnswer({
    reply: model.reply,
    calls: model.calls,
    suggest: model.suggest,
    facts,
    now: input.now,
    registered: input.registered,
    message: input.message,
  });
  return {
    reply: grounded.reply,
    booking: grounded.booking,
    interest: grounded.interest,
    choices: grounded.choices,
    understood: grounded.grounded ? "openai" : "rules",
    selectedTourId: grounded.selectedTourId ?? pageTour?.id ?? null,
  };
}
