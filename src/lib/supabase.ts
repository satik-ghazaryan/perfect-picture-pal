import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

function createSupabase() {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return createClient<Database>(url, anonKey);
}

export const supabase = createSupabase();
export const isSupabaseConfigured = supabase !== null;
