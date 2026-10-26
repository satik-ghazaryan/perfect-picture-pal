import { createClient } from "@supabase/supabase-js";

export const PYTHON_TIMEOUT_MS = 240_000;
const GENERATE_RATE_LIMIT = 5;
const GENERATE_RATE_WINDOW_MS = 60_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Best-effort in-memory limiter for this process only. On serverless each
// isolate has its own map; Python enforces the real per-user 5/min limit.
const generateHits = new Map<string, number[]>();

function envValue(name: string) {
  if (typeof process === "undefined" || !process.env) return "";
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
}

function jsonError(status: number, error: string) {
  return Response.json(
    { error },
    { status, headers: { "cache-control": "no-store" } },
  );
}

export function methodNotAllowed() {
  return jsonError(405, "Method not allowed");
}

function pythonConfig() {
  const secret = envValue("IDEAS_API_SECRET");
  const raw = envValue("PYTHON_BACKEND_URL").replace(/\/$/, "");
  if (!secret || !raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  const loopback = host === "localhost" || host === "127.0.0.1";
  if (parsed.protocol === "https:") return { baseUrl: raw, secret };
  if (parsed.protocol === "http:" && loopback) return { baseUrl: raw, secret };
  return null;
}

function supabaseConfig() {
  const url = envValue("SUPABASE_URL") || envValue("VITE_SUPABASE_URL");
  const anonKey = envValue("SUPABASE_ANON_KEY") || envValue("VITE_SUPABASE_ANON_KEY");
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

function bearerToken(request: Request) {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(\S+)/i.exec(header.trim());
  const token = match?.[1]?.trim() ?? "";
  return token || null;
}

export function isUuid(value: string) {
  return UUID_RE.test(value);
}

export function rateLimitGenerate(userId: string) {
  const now = Date.now();
  const recent = (generateHits.get(userId) ?? []).filter((stamp) => now - stamp < GENERATE_RATE_WINDOW_MS);
  if (recent.length >= GENERATE_RATE_LIMIT) {
    generateHits.set(userId, recent);
    return false;
  }
  recent.push(now);
  generateHits.set(userId, recent);
  return true;
}

export async function requireAdmin(request: Request): Promise<{ userId: string; token: string } | Response> {
  const token = bearerToken(request);
  if (!token) return jsonError(401, "Unauthorized");
  const supabaseEnv = supabaseConfig();
  if (!supabaseEnv) return jsonError(503, "Service unavailable");
  const client = createClient(supabaseEnv.url, supabaseEnv.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: userError } = await client.auth.getUser(token);
  if (userError || !userData.user?.id) return jsonError(401, "Unauthorized");
  try {
    const { data, error } = await client.rpc("is_admin" as never);
    if (error || data !== true) return jsonError(403, "Forbidden");
  } catch {
    return jsonError(403, "Forbidden");
  }
  return { userId: userData.user.id, token };
}

export async function forwardToPython(
  path: string,
  init: { method: string; userId: string; body?: string },
): Promise<Response> {
  const python = pythonConfig();
  if (!python) return jsonError(503, "Service unavailable");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PYTHON_TIMEOUT_MS);
  const headers: Record<string, string> = {
    accept: "application/json",
    "x-api-secret": python.secret,
    "x-user-id": init.userId,
  };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  const requestInit: RequestInit = {
    method: init.method,
    headers,
    signal: controller.signal,
  };
  if (init.body !== undefined) requestInit.body = init.body;
  try {
    const response = await fetch(`${python.baseUrl}${path}`, requestInit);
    if (response.status === 404) return jsonError(404, "Not found");
    if (response.status === 429) return jsonError(429, "Too many requests");
    if (response.status === 401 || response.status === 503 || response.status >= 500) {
      return jsonError(502, "Upstream service error");
    }
    if (!response.ok) return jsonError(502, "Upstream service error");
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return jsonError(502, "Upstream service error");
    }
    return Response.json(payload, { status: 200, headers: { "cache-control": "no-store" } });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return aborted ? jsonError(504, "Upstream timeout") : jsonError(502, "Upstream service error");
  } finally {
    clearTimeout(timer);
  }
}

export { jsonError };
