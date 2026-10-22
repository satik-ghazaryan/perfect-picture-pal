import { createFileRoute } from "@tanstack/react-router";
import {
  forwardToPython,
  jsonError,
  methodNotAllowed,
  rateLimitGenerate,
  requireAdmin,
} from "@/lib/ideas-proxy.server";

const MAX_BODY_BYTES = 10 * 1024;

function asTrimmedString(value: unknown) {
  return typeof value === "string" ? value.trim() : null;
}

function asInt(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return Number.parseInt(value.trim(), 10);
  return null;
}

function validateGenerateBody(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const season = asTrimmedString(record["season"]);
  const targetAudience = asTrimmedString(record["target_audience"]);
  const tourType = asTrimmedString(record["tour_type"]);
  const departureLocation = asTrimmedString(record["departure_location"]) ?? "Armavir";
  const preferences = asTrimmedString(record["preferences"]) ?? "";
  const durationDays = record["duration_days"] === undefined ? 1 : asInt(record["duration_days"]);
  const budgetAmd = asInt(record["budget_amd"]);
  const count = record["count"] === undefined ? 3 : asInt(record["count"]);
  if (!season || season.length < 2 || season.length > 500) return null;
  if (!targetAudience || targetAudience.length < 2 || targetAudience.length > 500) return null;
  if (!tourType || tourType.length < 2 || tourType.length > 500) return null;
  if (departureLocation.length < 2 || departureLocation.length > 500) return null;
  if (preferences.length > 500) return null;
  if (durationDays === null || durationDays < 1 || durationDays > 14) return null;
  if (budgetAmd === null || budgetAmd < 0 || budgetAmd > 1_000_000) return null;
  if (count === null || count < 1 || count > 5) return null;
  return {
    season,
    target_audience: targetAudience,
    tour_type: tourType,
    duration_days: durationDays,
    budget_amd: budgetAmd,
    departure_location: departureLocation,
    preferences,
    count,
  };
}

async function handlePost({ request }: { request: Request }) {
  const admin = await requireAdmin(request);
  if (admin instanceof Response) return admin;
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return jsonError(413, "Payload too large");
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return jsonError(422, "Invalid request");
  }
  if (raw.length > MAX_BODY_BYTES) return jsonError(413, "Payload too large");
  let parsed: unknown;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    return jsonError(422, "Invalid request");
  }
  const body = validateGenerateBody(parsed);
  if (!body) return jsonError(422, "Invalid request");
  if (!rateLimitGenerate(admin.userId)) return jsonError(429, "Too many requests");
  return forwardToPython("/api/generate-ideas", {
    method: "POST",
    userId: admin.userId,
    body: JSON.stringify(body),
  });
}

export const Route = createFileRoute("/api/ideas/generate")({
  server: {
    handlers: {
      POST: handlePost,
      GET: async () => methodNotAllowed(),
      PUT: async () => methodNotAllowed(),
      PATCH: async () => methodNotAllowed(),
      DELETE: async () => methodNotAllowed(),
    },
  },
});
