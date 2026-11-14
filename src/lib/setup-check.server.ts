/** Which server settings the website has. Only yes/no answers leave the server. */
const GROUPS = {
  database: [
    ["SUPABASE_URL", "VITE_SUPABASE_URL"],
    ["SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY"],
  ],
  bookingLookup: [["SUPABASE_SERVICE_ROLE_KEY"]],
  backend: [["PYTHON_BACKEND_URL"]],
  chat: [["CHAT_INTENT_API_SECRET"]],
  ideas: [["IDEAS_API_SECRET"]],
} as const;

export type SetupStatus = { ok: boolean; settings: Record<keyof typeof GROUPS, boolean> };

export function setupStatus(env: Record<string, string | undefined>): SetupStatus {
  const present = (name: string) => (env[name] ?? "").trim().length > 0;
  const settings = Object.fromEntries(
    Object.entries(GROUPS).map(([group, needs]) => [
      group,
      needs.every((choices) => choices.some(present)),
    ]),
  ) as SetupStatus["settings"];
  return { ok: Object.values(settings).every(Boolean), settings };
}

export function handleSetupStatus() {
  const env = typeof process !== "undefined" && process.env ? process.env : {};
  return Response.json(setupStatus(env), { headers: { "cache-control": "no-store" } });
}
