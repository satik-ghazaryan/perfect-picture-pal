import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";

function createSupabase(): SupabaseClient<Database> | null {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return null;
  try {
    return createClient<Database>(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  } catch (error) {
    console.error("[Արի Գնանք] Supabase client failed to initialize.", error);
    return null;
  }
}

export const supabase = createSupabase();
export const isSupabaseConfigured = supabase !== null;
