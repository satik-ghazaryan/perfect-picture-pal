import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type {
  TourIdeaBreakdown,
  TourIdeaInput,
  TourIdeaMarket,
  TourIdeaMarketOffer,
  TourIdeaMarketPosition,
  TourIdeaProfitability,
  TourIdeaResearch,
  TourIdeaResearchHit,
  TourIdeaResult,
  TourIdeaStop,
} from "@/types";

const GROUP_SIZE_FALLBACK = 17;

const SEARCH_FAILURE_STATUSES = new Set([
  "tavily_error",
  "ddg_error",
  "tavily_timeout",
  "ddg_timeout",
  "too_few_results",
  "empty",
]);
const SEARCH_QUIET_STATUSES = new Set(["", "ok", "tavily_no_key"]);
const VERIFY_NOTE_HY_EXACT: Record<string, string> = {
  "price needs route distance": "Անհրաժեշտ է երթուղու հեռավորությունը",
  "Route km is an estimate": "Երթուղու կմ-ը գնահատական է",
  "No live web results; places and prices need human research":
    "Կենդանի որոնման արդյունքներ չկան. վայրերն ու գները հարկավոր է ստուգել ձեռքով",
  "No competitor data was found": "Մրցակցային տվյալներ չեն գտնվել",
  "Not enough concrete places found; needs human research":
    "Բավարար կոնկրետ վայրեր չեն գտնվել. հարկավոր է ձեռքով ստուգում",
  "Place data sources unavailable": "Վայրերի տվյալների աղբյուրները անհասանելի են",
  "No destination stops after Armavir; route km is 0": "Արմավիրից հետո նշանակման կանգառներ չկան. երթուղու կմ-ը 0 է",
  "Armenian text needs review": "Հայերեն տեքստը հարկավոր է վերանայել",
};
const VERIFY_NOTE_HY_PREFIXES: Array<[string, string]> = [
  ["Place not in search results:", "Վայրը որոնման արդյունքներում չկա:"],
  ["Needs sourced fact URL:", "Հարկավոր է աղբյուրի URL:"],
  ["Could not geocode stop:", "Չհաջողվեց գեոկոդավորել կանգառը:"],
  ["Web distance cross-check (not used for price):", "Հեռավորության համացանցային ստուգում (գնի համար չի օգտագործվում):"],
  ["Generic stop, no concrete place:", "Ընդհանուր կանգառ, կոնկրետ վայր չկա:"],
];

export function searchStatusNote(status: string | undefined, usefulCount = 0): string {
  const code = String(status ?? "").trim();
  if (SEARCH_QUIET_STATUSES.has(code)) return "";
  if (code === "partial") return `Որոնումը մասնակի է (օգտակար արդյունքներ՝ ${usefulCount || 0})`;
  if (SEARCH_FAILURE_STATUSES.has(code) || code) return `search failed: ${code}`;
  return "";
}

export function formatVerifyNoteHy(note: string): string {
  const mapped = VERIFY_NOTE_HY_EXACT[note];
  if (mapped) return mapped;
  for (const [english, armenian] of VERIFY_NOTE_HY_PREFIXES) {
    if (note.startsWith(english)) return armenian + note.slice(english.length);
  }
  return note;
}

const LAST_RUN_KEY = "ari-gnank-last-idea-run";
const CLIENT_TIMEOUT_MS = 250_000;
const ADMIN_REQUIRED_ERROR = "Մուտք գործեք admin հաշվով";

function asUuid(value: string | null | undefined) {
  if (!value) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : null;
}

export function parseAmd(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.round(value));
  if (typeof value === "string") {
    const digits = value.replace(/[^\d]/g, "");
    return digits ? Number.parseInt(digits, 10) : 0;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return parseAmd(record.amd ?? record.amount ?? record.value ?? record.price);
  }
  return 0;
}

function asStop(value: unknown): TourIdeaStop | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const time = String(record.time ?? "").trim();
  const description = String(record.description ?? "").trim();
  const hasPlaceName = "place_name" in record;
  const placeRaw = record["place_name"];
  const placeName =
    placeRaw == null || String(placeRaw).trim() === "" ? null : String(placeRaw).trim();
  const activity = String(record["activity"] ?? "").trim();
  let title = String(record.title ?? "").trim();
  if (!title && placeName) {
    title = activity ? `${placeName} — ${activity}` : placeName;
  }
  if (!title && activity) title = activity;
  if (!time || !title) return null;
  const titleEn = String(record["title_en"] ?? "").trim() || (placeName && activity ? `${placeName} — ${activity}` : "");
  const titleRu = String(record["title_ru"] ?? "").trim();
  const descriptionEn = String(record["description_en"] ?? "").trim();
  const descriptionRu = String(record["description_ru"] ?? "").trim();
  const sourceUrl = asHttpUrl(record["source_url"]);
  const stop: TourIdeaStop = { time, title, description };
  if (titleEn) stop.title_en = titleEn;
  if (titleRu) stop.title_ru = titleRu;
  if (descriptionEn) stop.description_en = descriptionEn;
  if (descriptionRu) stop.description_ru = descriptionRu;
  if (sourceUrl) stop.source_url = sourceUrl;
  if (hasPlaceName) stop.place_name = placeName;
  if (activity) stop.activity = activity;
  return stop;
}

function asBreakdown(value: unknown): TourIdeaBreakdown | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  return {
    transport_amd: parseAmd(record.transport_amd ?? record.transport),
    meals_amd: parseAmd(record.meals_amd ?? record.meals),
    entrance_fees_amd: parseAmd(record.entrance_fees_amd ?? record.entrance_fees ?? record.tickets),
    guide_amd: parseAmd(record.guide_amd ?? record.guide),
    other_amd: parseAmd(record.other_amd ?? record.other),
    yerevan_transfer_amd: parseAmd(record.yerevan_transfer_amd ?? record.yerevan_transfer),
    notes: String(record.notes ?? "Estimated. Needs verification."),
  };
}

function asProfitability(value: unknown): TourIdeaProfitability | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const groupSize = parseAmd(record.group_size) || GROUP_SIZE_FALLBACK;
  const revenue = parseAmd(record.revenue_per_person_amd ?? record.revenue_per_person);
  const expense = parseAmd(record.expense_per_person_amd ?? record.expense_per_person);
  const profit = parseAmd(record.profit_per_person_amd ?? record.profit_per_person) || Math.max(0, revenue - expense);
  return {
    group_size: groupSize,
    revenue_per_person_amd: revenue,
    expense_per_person_amd: expense,
    profit_per_person_amd: profit,
    revenue_per_group_amd: parseAmd(record.revenue_per_group_amd) || revenue * groupSize,
    expense_per_group_amd: parseAmd(record.expense_per_group_amd) || expense * groupSize,
    profit_per_group_amd: parseAmd(record.profit_per_group_amd) || profit * groupSize,
    assumptions: String(record.assumptions ?? "Estimated. Needs verification."),
    confidence: record["confidence"] === "needs_verification" ? "needs_verification" : "estimated",
  };
}

function asHttpUrl(value: unknown): string {
  const raw = String(value ?? "").trim();
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.toString();
  } catch {
    return "";
  }
  return "";
}

function asOffers(value: unknown): TourIdeaMarketOffer[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    return [{
      title: String(record["title"] ?? ""),
      url: asHttpUrl(record["url"]),
      observed_price_amd: parseAmd(record["observed_price_amd"]),
      observed_amount: typeof record["observed_amount"] === "number" ? record["observed_amount"] : parseAmd(record["observed_amount"]),
      observed_currency: String(record["observed_currency"] ?? ""),
      conversion_rate: parseAmd(record["conversion_rate"]),
      conversion_estimated: Boolean(record["conversion_estimated"]),
      found_on: String(record["found_on"] ?? ""),
      label: String(record["label"] ?? "market_reference"),
      snippet: String(record["snippet"] ?? ""),
    }];
  });
}

function asMarket(value: unknown): TourIdeaMarket | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  return {
    label: String(record["label"] ?? "market_reference"),
    offer_count: parseAmd(record["offer_count"]),
    price_min_amd: record["price_min_amd"] == null ? null : parseAmd(record["price_min_amd"]),
    price_median_amd: record["price_median_amd"] == null ? null : parseAmd(record["price_median_amd"]),
    price_max_amd: record["price_max_amd"] == null ? null : parseAmd(record["price_max_amd"]),
    difference_amd: parseAmd(record["difference_amd"]),
    offers: asOffers(record["offers"]),
  };
}

function asPosition(value: unknown): TourIdeaMarketPosition | undefined {
  if (value === "below_market" || value === "in_range" || value === "above_market" || value === "unknown") return value;
  return undefined;
}

export function normalizeResearch(value: unknown): TourIdeaResearch {
  if (!value || typeof value !== "object") {
    return {
      live: false,
      provider: "none",
      retrieved_at: "",
      disclaimer: "",
      queries: [],
      results: [],
      market_offers: [],
      error: "",
      search_status: "",
      tavily_key_present: false,
      useful_result_count: 0,
      provider_status: {},
      place_candidates: [],
      pages_fetched: 0,
    };
  }
  const record = value as Record<string, unknown>;
  const results: TourIdeaResearchHit[] = Array.isArray(record["results"])
    ? record["results"].flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      return [{
        title: String(row["title"] ?? ""),
        url: asHttpUrl(row["url"]),
        snippet: String(row["snippet"] ?? ""),
        query: String(row["query"] ?? ""),
        kind: String(row["kind"] ?? ""),
      }];
    })
    : [];
  return {
    live: Boolean(record["live"]),
    provider: String(record["provider"] ?? "none"),
    retrieved_at: String(record["retrieved_at"] ?? ""),
    disclaimer: String(record["disclaimer"] ?? ""),
    queries: Array.isArray(record["queries"]) ? record["queries"].map((item) => String(item)) : [],
    results,
    market_offers: asOffers(record["market_offers"]),
    error: String(record["error"] ?? ""),
    search_status: String(record["search_status"] ?? record["error"] ?? ""),
    tavily_key_present: Boolean(record["tavily_key_present"]),
    useful_result_count: Number(record["useful_result_count"] ?? results.length) || 0,
    provider_status: record["provider_status"] && typeof record["provider_status"] === "object"
      ? {
        tavily: String((record["provider_status"] as Record<string, unknown>)["tavily"] ?? ""),
        ddg: String((record["provider_status"] as Record<string, unknown>)["ddg"] ?? ""),
        tavily_key_present: Boolean((record["provider_status"] as Record<string, unknown>)["tavily_key_present"]),
      }
      : {},
    place_en: typeof record["place_en"] === "string" ? record["place_en"] : null,
    region_en: typeof record["region_en"] === "string" ? record["region_en"] : null,
    pages_fetched: Number(record["pages_fetched"] ?? 0) || 0,
    place_candidates: Array.isArray(record["place_candidates"])
      ? record["place_candidates"].flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const row = item as Record<string, unknown>;
        const name = String(row["name_en"] ?? "").trim();
        if (!name) return [];
        return [{
          name_en: name,
          type: String(row["type"] ?? ""),
          source_url: asHttpUrl(row["source_url"]),
          osm_url: asHttpUrl(row["osm_url"]),
          wiki_url: asHttpUrl(row["wiki_url"]),
          description: String(row["description"] ?? ""),
          lat: typeof row["lat"] === "number" ? row["lat"] : Number(row["lat"]) || null,
          lon: typeof row["lon"] === "number" ? row["lon"] : Number(row["lon"]) || null,
          coord_source: String(row["coord_source"] ?? ""),
          distance_from_armavir_km:
            typeof row["distance_from_armavir_km"] === "number"
              ? row["distance_from_armavir_km"]
              : Number(row["distance_from_armavir_km"]) || null,
        }];
      })
      : [],
  };
}

export function normalizeTourIdea(value: unknown): TourIdeaResult | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = String(record.id ?? "").trim();
  const titleHy = String(record.title_hy ?? "").trim();
  if (!id || !titleHy) return null;
  const itinerary = Array.isArray(record.itinerary)
    ? record.itinerary.map(asStop).filter((item): item is TourIdeaStop => item !== null)
    : [];
  const highlights = Array.isArray(record.highlights)
    ? record.highlights.map((item) => String(item).trim()).filter(Boolean)
    : [];
  const result: TourIdeaResult = {
    id,
    title_hy: titleHy,
    title_en: String(record["title_en"] ?? ""),
    title_ru: String(record["title_ru"] ?? ""),
    description_hy: String(record["description_hy"] ?? ""),
    description_en: String(record["description_en"] ?? ""),
    description_ru: String(record["description_ru"] ?? ""),
    location_hy: String(record["location_hy"] ?? ""),
    location_en: String(record["location_en"] ?? ""),
    location_ru: String(record["location_ru"] ?? ""),
    price: record["price"] === null ? null : parseAmd(record["price"] ?? record["suggested_price"] ?? record["selling_price"]),
    duration_hours: typeof record["duration_hours"] === "number" ? record["duration_hours"] : Number(record["duration_hours"]) || 10,
    highlights,
    itinerary,
    notes: typeof record["notes"] === "string" ? record["notes"] : "",
    verify: Array.isArray(record["verify"]) ? record["verify"].map((item) => String(item)).filter(Boolean) : [],
    needs_verification: Boolean(record["needs_verification"]),
    source_urls: Array.isArray(record["source_urls"])
      ? record["source_urls"].map(asHttpUrl).filter(Boolean)
      : [],
    route_km: typeof record["route_km"] === "number" ? record["route_km"] : Number(record["route_km"]) || 0,
    km_source: typeof record["km_source"] === "string" ? record["km_source"] : "",
    geocoded_stops: Array.isArray(record["geocoded_stops"])
      ? record["geocoded_stops"]
          .map((item) => {
            if (!item || typeof item !== "object") return null;
            const row = item as Record<string, unknown>;
            const name = String(row.name ?? "").trim();
            const lat = typeof row.lat === "number" ? row.lat : Number(row.lat);
            const lon = typeof row.lon === "number" ? row.lon : Number(row.lon);
            if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
            return {
              name,
              lat,
              lon,
              coord_source: String(row.coord_source ?? "Nominatim"),
            };
          })
          .filter((item): item is { name: string; lat: number; lon: number; coord_source: string } => item !== null)
      : [],
    transport_rate_per_km_amd: parseAmd(record["transport_rate_per_km_amd"]) || 600,
    cost_per_person_amd: parseAmd(record["cost_per_person_amd"]),
    min_price_amd: parseAmd(record["min_price_amd"]),
  };
  const breakdown = asBreakdown(record["breakdown"] ?? record["cost_breakdown"] ?? record["costs"]);
  if (breakdown) result.breakdown = breakdown;
  const profitability = asProfitability(record["profitability"]);
  if (profitability) result.profitability = profitability;
  if (typeof record["budget_score"] === "number") result.budget_score = record["budget_score"];
  if (typeof record["logistics_score"] === "number") result.logistics_score = record["logistics_score"];
  if (typeof record["appeal_score"] === "number") result.appeal_score = record["appeal_score"];
  if (typeof record["quality_score"] === "number") result.quality_score = record["quality_score"];
  if (record["budget_fit"] === "over" || record["budget_fit"] === "within") result.budget_fit = record["budget_fit"];
  const position = asPosition(record["market_position"]);
  if (position) result.market_position = position;
  const market = asMarket(record["market"]);
  if (market) result.market = market;
  return result;
}

type GeneratePayload = {
  run_id?: string;
  ideas?: unknown[];
  research_summary?: string;
  research?: unknown;
  detail?: unknown;
};

async function adminAccessToken() {
  if (!isSupabaseConfigured || !supabase) return null;
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token?.trim();
  return token || null;
}

function ideaRequestError(status: number | "timeout") {
  if (status === "timeout" || status === 504) return "Գեներացիան երկար տևեց։ Փորձեք նորից։";
  if (status === 401 || status === 403) return "Ադմինի մուտք չկա։ Մտեք նորից։";
  if (status === 422) return "Մուտքագրված տվյալները սխալ են։";
  if (status === 429) return "Չափից շատ հարցում։ Փորձեք մի փոքր ուշ։";
  if (status === 502 || status === 503) return "Ծառայությունը ժամանակավորապես անհասանելի է։";
  return "Գաղափարները չգեներացվեցին։";
}

function timedFetch(input: string, init: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function cacheRun(runId: string, ideas: TourIdeaResult[], summary: string, research: TourIdeaResearch) {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(LAST_RUN_KEY, JSON.stringify({ runId, ideas, summary, research }));
}

export function readCachedIdeaRun(): {
  runId: string;
  ideas: TourIdeaResult[];
  summary: string;
  research: TourIdeaResearch;
} | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(LAST_RUN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { runId?: string; ideas?: unknown[]; summary?: string; research?: unknown };
    const ideas = Array.isArray(parsed.ideas)
      ? parsed.ideas.map(normalizeTourIdea).filter((item): item is TourIdeaResult => item !== null)
      : [];
    if (!parsed.runId || ideas.length === 0) return null;
    return {
      runId: parsed.runId,
      ideas,
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      research: normalizeResearch(parsed.research),
    };
  } catch {
    return null;
  }
}

export async function fetchIdeaRun(runId: string): Promise<{
  runId: string;
  ideas: TourIdeaResult[];
  summary: string;
  research: TourIdeaResearch;
} | null> {
  try {
    const token = await adminAccessToken();
    if (!token) return null;
    const response = await timedFetch(`/api/ideas/runs/${encodeURIComponent(runId)}`, {
      headers: { accept: "application/json", authorization: `Bearer ${token}` },
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as GeneratePayload;
    const ideas = Array.isArray(payload.ideas)
      ? payload.ideas.map(normalizeTourIdea).filter((item): item is TourIdeaResult => item !== null)
      : [];
    if (ideas.length === 0) return null;
    const resolved = {
      runId: payload.run_id || runId,
      ideas,
      summary: typeof payload.research_summary === "string" ? payload.research_summary : "",
      research: normalizeResearch(payload.research),
    };
    cacheRun(resolved.runId, resolved.ideas, resolved.summary, resolved.research);
    return resolved;
  } catch {
    return null;
  }
}

export async function generateTourIdeas(input: TourIdeaInput): Promise<{
  runId: string;
  ideas: TourIdeaResult[];
  research_summary: string;
  research: TourIdeaResearch;
}> {
  const token = await adminAccessToken();
  if (!token) throw new Error(ADMIN_REQUIRED_ERROR);
  let response: Response;
  try {
    response = await timedFetch("/api/ideas/generate", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(input),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    throw new Error(ideaRequestError(timedOut ? "timeout" : 502));
  }
  if (!response.ok) {
    throw new Error(ideaRequestError(response.status));
  }
  const payload = (await response.json().catch(() => null)) as GeneratePayload | null;
  let ideas = Array.isArray(payload?.ideas)
    ? payload.ideas.map(normalizeTourIdea).filter((item): item is TourIdeaResult => item !== null)
    : [];
  const summary = typeof payload?.research_summary === "string" ? payload.research_summary : "";
  const research = normalizeResearch(payload?.research);
  const runId = typeof payload?.run_id === "string" ? payload.run_id : "";
  if (runId) {
    const stored = await fetchIdeaRun(runId);
    if (stored) {
      return {
        runId: stored.runId,
        ideas: stored.ideas,
        research_summary: stored.summary,
        research: stored.research,
      };
    }
  }
  if (ideas.length === 0) throw new Error("Գործակալը գաղափարներ չվերադարձրեց։");
  if (runId) cacheRun(runId, ideas, summary, research);
  return { runId, ideas, research_summary: summary, research };
}

export async function saveTourIdeaDraft(input: TourIdeaInput, ideas: TourIdeaResult[], _createdBy?: string | null) {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error("Supabase-ը կարգավորված չէ։ Draft-ը չպահվեց։");
  }
  const { data: auth, error: authError } = await supabase.auth.getUser();
  const userId = auth.user?.id ?? null;
  if (authError || !userId) {
    throw new Error("Մուտք գործեք ադմինի հաշվով։ Draft-ը չպահվեց։");
  }
  const { error } = await supabase.from("tour_ideas").insert({
    inputs: input,
    generated_ideas: ideas,
    status: "draft",
    created_by: userId,
  });
  if (error) throw new Error("Draft-ը Supabase-ում չպահվեց։");
}
