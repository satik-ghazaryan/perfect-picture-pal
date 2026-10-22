import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { TourIdeaBreakdown, TourIdeaInput, TourIdeaProfitability, TourIdeaResult, TourIdeaStop } from "@/types";

const LAST_RUN_KEY = "ari-gnank-last-idea-run";
const CLIENT_TIMEOUT_MS = 130_000;
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
  const title = String(record.title ?? "").trim();
  const description = String(record.description ?? "").trim();
  if (!time || !title) return null;
  return { time, title, description };
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
  const groupSize = parseAmd(record.group_size) || 12;
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
    confidence: record.confidence === "needs_verification" ? "needs_verification" : "estimated",
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
  return {
    id,
    title_hy: titleHy,
    title_en: String(record.title_en ?? ""),
    title_ru: String(record.title_ru ?? ""),
    description_hy: String(record.description_hy ?? ""),
    description_en: String(record.description_en ?? ""),
    description_ru: String(record.description_ru ?? ""),
    location_hy: String(record.location_hy ?? ""),
    location_en: String(record.location_en ?? ""),
    location_ru: String(record.location_ru ?? ""),
    price: parseAmd(record.price ?? record.suggested_price ?? record.selling_price),
    duration_hours: typeof record.duration_hours === "number" ? record.duration_hours : Number(record.duration_hours) || 10,
    highlights,
    itinerary,
    breakdown: asBreakdown(record.breakdown ?? record.cost_breakdown ?? record.costs),
    profitability: asProfitability(record.profitability),
    budget_score: typeof record.budget_score === "number" ? record.budget_score : undefined,
    logistics_score: typeof record.logistics_score === "number" ? record.logistics_score : undefined,
    appeal_score: typeof record.appeal_score === "number" ? record.appeal_score : undefined,
    quality_score: typeof record.quality_score === "number" ? record.quality_score : undefined,
    budget_fit: record.budget_fit === "over" ? "over" : record.budget_fit === "within" ? "within" : undefined,
    notes: typeof record.notes === "string" ? record.notes : "",
  };
}

type GeneratePayload = {
  run_id?: string;
  ideas?: unknown[];
  research_summary?: string;
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

function cacheRun(runId: string, ideas: TourIdeaResult[], summary: string) {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(LAST_RUN_KEY, JSON.stringify({ runId, ideas, summary }));
}

export function readCachedIdeaRun(): { runId: string; ideas: TourIdeaResult[]; summary: string } | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(LAST_RUN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { runId?: string; ideas?: unknown[]; summary?: string };
    const ideas = Array.isArray(parsed.ideas)
      ? parsed.ideas.map(normalizeTourIdea).filter((item): item is TourIdeaResult => item !== null)
      : [];
    if (!parsed.runId || ideas.length === 0) return null;
    return { runId: parsed.runId, ideas, summary: typeof parsed.summary === "string" ? parsed.summary : "" };
  } catch {
    return null;
  }
}

export async function fetchIdeaRun(runId: string): Promise<{ runId: string; ideas: TourIdeaResult[]; summary: string } | null> {
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
    const resolved = { runId: payload.run_id || runId, ideas, summary: typeof payload.research_summary === "string" ? payload.research_summary : "" };
    cacheRun(resolved.runId, resolved.ideas, resolved.summary);
    return resolved;
  } catch {
    return null;
  }
}

export async function generateTourIdeas(input: TourIdeaInput): Promise<{ runId: string; ideas: TourIdeaResult[]; research_summary: string }> {
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
  let summary = typeof payload?.research_summary === "string" ? payload.research_summary : "";
  const runId = typeof payload?.run_id === "string" ? payload.run_id : "";
  if (runId) {
    const stored = await fetchIdeaRun(runId);
    if (stored) {
      return { runId: stored.runId, ideas: stored.ideas, research_summary: stored.summary };
    }
  }
  if (ideas.length === 0) throw new Error("Գործակալը գաղափարներ չվերադարձրեց։");
  if (runId) cacheRun(runId, ideas, summary);
  return { runId, ideas, research_summary: summary };
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
