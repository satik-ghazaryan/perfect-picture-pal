import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { TourIdeaInput, TourIdeaResult } from "@/types";

function pythonBackendUrl() {
  const configured = import.meta.env.VITE_PYTHON_BACKEND_URL?.trim();
  return (configured || "http://localhost:8000").replace(/\/$/, "");
}

function asUuid(value: string | null | undefined) {
  if (!value) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : null;
}

export async function generateTourIdeas(input: TourIdeaInput): Promise<{ ideas: TourIdeaResult[]; research_summary: string }> {
  const response = await fetch(`${pythonBackendUrl()}/api/generate-ideas`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(input),
  });
  const payload = (await response.json().catch(() => null)) as
    | { ideas?: TourIdeaResult[]; research_summary?: string; detail?: unknown }
    | null;
  if (!response.ok) {
    const detail = payload && "detail" in payload ? payload.detail : null;
    const message = typeof detail === "string" ? detail : "Գաղափարները չգեներացվեցին։";
    throw new Error(message);
  }
  const ideas = Array.isArray(payload?.ideas) ? payload.ideas : [];
  if (ideas.length === 0) throw new Error("Գործակալը գաղափարներ չվերադարձրեց։");
  return { ideas, research_summary: typeof payload?.research_summary === "string" ? payload.research_summary : "" };
}

export async function saveTourIdeaDraft(input: TourIdeaInput, ideas: TourIdeaResult[], createdBy: string | null) {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error("Supabase-ը կարգավորված չէ։ Draft-ը չպահվեց։");
  }
  const { error } = await supabase.from("tour_ideas").insert({
    inputs: input,
    generated_ideas: ideas,
    status: "draft",
    created_by: asUuid(createdBy),
  });
  if (error) throw new Error("Draft-ը Supabase-ում չպահվեց։");
}
