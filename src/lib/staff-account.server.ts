import { createClient } from "@supabase/supabase-js";
import { requireAdmin, jsonError } from "@/lib/ideas-proxy.server";
import {
  createStaffAccountRecord,
  isDuplicateStaffAuthError,
  setStaffAccountActive,
  updateStaffAccountRecord,
  type StaffAccountDraft,
  type StaffAccountRecord,
} from "@/lib/staff-account";

function envValue(name: string) {
  if (typeof process === "undefined" || !process.env) return "";
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
}

function serviceClient() {
  const url = envValue("SUPABASE_URL") || envValue("VITE_SUPABASE_URL");
  const key = envValue("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const MISSING_KEY =
  "Հաշիվների կառավարումը միացված չէ. Vercel-ի Environment Variables-ում բացակայում է SUPABASE_SERVICE_ROLE_KEY-ը։";

async function saveStaffProfile(
  client: NonNullable<ReturnType<typeof serviceClient>>,
  account: StaffAccountRecord,
) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data, error } = await client
      .from("profiles")
      .select("id")
      .eq("id", account.id)
      .maybeSingle();
    if (error) throw new Error("profile lookup failed");
    if (data) {
      const { error: updateError } = await client
        .from("profiles")
        .update({
          full_name: account.fullName,
          phone: account.phone,
          email: account.email,
          role: account.role,
          avatar_url: account.avatarUrl || null,
          bio: account.bio || null,
        })
        .eq("id", account.id);
      if (updateError) throw new Error("profile update failed");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error("profile missing");
}

export async function handleCreateStaffAccount(request: Request) {
  const admin = await requireAdmin(request);
  if (admin instanceof Response) return admin;
  const service = serviceClient();
  if (!service) return jsonError(503, MISSING_KEY);
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonError(422, "Հարցումը թերի է։");
  }
  const body = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  const result = await createStaffAccountRecord(
    {
      role: text(body["role"]),
      fullName: text(body["fullName"]),
      phone: text(body["phone"]),
      email: text(body["email"]),
      password: text(body["password"]),
      avatarUrl: text(body["avatarUrl"]),
      bio: text(body["bio"]),
    },
    {
      createAuth: async (value: StaffAccountDraft) => {
        const { data, error } = await service.auth.admin.createUser({
          email: value.email,
          password: value.password,
          email_confirm: true,
          user_metadata: { full_name: value.fullName, phone: value.phone },
        });
        if (error || !data.user) {
          throw new Error(
            isDuplicateStaffAuthError(error?.message ?? "")
              ? (error?.message ?? "registered")
              : "create failed",
          );
        }
        return { id: data.user.id };
      },
      saveProfile: (account) => saveStaffProfile(service, account),
      deleteAuth: async (id) => {
        const { error } = await service.auth.admin.deleteUser(id);
        if (error) throw new Error("delete failed");
      },
    },
  );
  if (!result.ok) {
    const status = result.code === "duplicate" ? 409 : result.code === "invalid" ? 422 : 500;
    return jsonError(status, result.message);
  }
  return Response.json(result.account, { status: 201, headers: { "cache-control": "no-store" } });
}

export async function handleUpdateStaffAccount(request: Request) {
  const admin = await requireAdmin(request);
  if (admin instanceof Response) return admin;
  const service = serviceClient();
  if (!service) return jsonError(503, MISSING_KEY);
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonError(422, "Հարցումը թերի է։");
  }
  const body = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  const result = await updateStaffAccountRecord(
    {
      id: text(body["id"]),
      role: text(body["role"]),
      fullName: text(body["fullName"]),
      phone: text(body["phone"]),
      email: text(body["email"]),
      password: text(body["password"]),
      avatarUrl: text(body["avatarUrl"]),
      bio: text(body["bio"]),
    },
    {
      loadProfile: async (id) => {
        const { data, error } = await service
          .from("profiles")
          .select("role,email")
          .eq("id", id)
          .maybeSingle();
        if (error) throw new Error("profile lookup failed");
        if (!data) return null;
        const row = data as { role: string | null; email: string | null };
        let email = row.email ?? "";
        if (!email) {
          // Older rows have no email in the profile; the sign-in email is the one that counts.
          const { data: auth } = await service.auth.admin.getUserById(id);
          email = auth.user?.email ?? "";
        }
        return { role: row.role ?? "", email };
      },
      updateAuth: async (id, change) => {
        const { error } = await service.auth.admin.updateUserById(id, {
          ...(change.email !== undefined ? { email: change.email, email_confirm: true } : {}),
          ...(change.password !== undefined ? { password: change.password } : {}),
        });
        if (error) {
          throw new Error(
            isDuplicateStaffAuthError(error.message) ? error.message : "update failed",
          );
        }
      },
      saveProfile: (account) => saveStaffProfile(service, account),
    },
  );
  if (!result.ok) {
    const status =
      result.code === "duplicate"
        ? 409
        : result.code === "invalid"
          ? 422
          : result.code === "not_staff"
            ? 403
            : 500;
    return jsonError(status, result.message);
  }
  return Response.json(result.account, { status: 200, headers: { "cache-control": "no-store" } });
}

/** A date far enough ahead that a switched-off account stays off until it is switched on again. */
const SWITCHED_OFF = "876000h";

function yerevanToday() {
  return new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export async function handleSetStaffActive(request: Request) {
  const admin = await requireAdmin(request);
  if (admin instanceof Response) return admin;
  const service = serviceClient();
  if (!service) return jsonError(503, MISSING_KEY);
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonError(422, "Հարցումը թերի է։");
  }
  const body = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  if (typeof body["active"] !== "boolean") return jsonError(422, "Հարցումը թերի է։");
  const result = await setStaffAccountActive(
    { id: typeof body["id"] === "string" ? body["id"] : "", active: body["active"] },
    {
      loadProfile: async (id) => {
        const { data, error } = await service
          .from("profiles")
          .select("role")
          .eq("id", id)
          .maybeSingle();
        if (error) throw new Error("profile lookup failed");
        return data ? { role: (data as { role: string | null }).role ?? "" } : null;
      },
      setSignIn: async (id, allowed) => {
        const { error } = await service.auth.admin.updateUserById(id, {
          ban_duration: allowed ? "none" : SWITCHED_OFF,
        });
        if (error) throw new Error("sign-in change failed");
      },
      clearUpcoming: async (id) => {
        const today = yerevanToday();
        const guide = await service
          .from("departures")
          .update({ guide_id: null })
          .eq("guide_id", id)
          .gte("departure_date", today);
        const driver = await service
          .from("departures")
          .update({ driver_id: null })
          .eq("driver_id", id)
          .gte("departure_date", today);
        if (guide.error || driver.error) throw new Error("assignment change failed");
      },
    },
  );
  if (!result.ok) {
    const status = result.code === "invalid" ? 422 : result.code === "not_staff" ? 403 : 500;
    return jsonError(status, result.message);
  }
  return Response.json(
    { id: result.id, active: result.active },
    { status: 200, headers: { "cache-control": "no-store" } },
  );
}

/** Ids of accounts whose sign-in is switched off, so the admin page can mark them. */
export async function handleListDisabledStaff(request: Request) {
  const admin = await requireAdmin(request);
  if (admin instanceof Response) return admin;
  const service = serviceClient();
  if (!service) return jsonError(503, MISSING_KEY);
  const { data, error } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) return jsonError(500, "Հաշիվների վիճակը չբեռնվեց։");
  const now = Date.now();
  const disabled = data.users
    .filter((user) => {
      const until = (user as { banned_until?: string | null }).banned_until;
      return typeof until === "string" && Date.parse(until) > now;
    })
    .map((user) => user.id);
  return Response.json({ disabled }, { status: 200, headers: { "cache-control": "no-store" } });
}
