import { createClient } from "@supabase/supabase-js";

const rawEmail = (process.env.ADMIN_EMAIL || "arev@arignank.am").trim().toLowerCase();
const EMAIL = rawEmail === "arev" ? "arev@arignank.am" : rawEmail;
const PASSWORD = process.env.ADMIN_PASSWORD || "#arev#";
const URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!URL || !SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY.");
  console.error("Set them in the environment, then run:");
  console.error('  node --env-file=backend/.env scripts/update-admin-password.mjs');
  process.exit(1);
}

const admin = createClient(URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
if (error) {
  console.error("Could not list users:", error.message);
  process.exit(1);
}

let user = data.users.find((item) => (item.email || "").toLowerCase() === EMAIL);
if (!user) {
  const created = await admin.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: "Ադմինիստրատոր", role: "admin" },
  });
  if (created.error || !created.data.user) {
    console.error("Could not create admin user:", created.error?.message);
    process.exit(1);
  }
  user = created.data.user;
  console.log("Created auth user", user.id);
} else {
  const updated = await admin.auth.admin.updateUserById(user.id, { password: PASSWORD });
  if (updated.error) {
    console.error("Could not update password:", updated.error.message);
    process.exit(1);
  }
  console.log("Updated password for", user.id);
}

const { error: profileError } = await admin.from("profiles").upsert(
  {
    id: user.id,
    full_name: "Ադմինիստրատոր",
    email: EMAIL,
    role: "admin",
  },
  { onConflict: "id" },
);
if (profileError) {
  console.error("Password updated, but profile role could not be saved:", profileError.message);
  process.exit(1);
}

const { data: profile } = await admin.from("profiles").select("id, email, role").eq("id", user.id).maybeSingle();
console.log("Admin profile ready:", profile ?? { id: user.id, email: EMAIL, role: "admin" });
