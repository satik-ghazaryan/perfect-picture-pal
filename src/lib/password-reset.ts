import { isSupabaseConfigured, supabase } from "@/lib/supabase";

export const RESET_PATH = "/reset-password";

export function validNewPassword(password: string, repeat: string) {
  if (password.length < 6) return "Գաղտնաբառը առնվազն 6 նիշ պետք է լինի։";
  if (password !== repeat) return "Երկու դաշտում գաղտնաբառը պետք է նույնը լինի։";
  return "";
}

/** Guides and drivers get their password from the admin; only tourists and admins reset their own. */
export function mayResetOwnPassword(role: string | null | undefined) {
  return role !== "guide" && role !== "driver";
}

/** Ask Supabase to email a reset link. The answer is the same whether or not the address has an account. */
export async function requestPasswordReset(email: string, origin: string) {
  const address = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new Error("Գրեք գործող էլ. փոստ։");
  if (!isSupabaseConfigured || !supabase) {
    throw new Error("Գաղտնաբառի վերականգնումը հիմա հասանելի չէ։");
  }
  const { error } = await supabase.auth.resetPasswordForEmail(address, {
    redirectTo: `${origin}${RESET_PATH}`,
  });
  if (error) {
    if (/rate|too many|seconds/i.test(error.message)) {
      throw new Error("Նամակը քիչ առաջ է ուղարկվել։ Սպասեք մեկ րոպե և փորձեք նորից։");
    }
    throw new Error("Նամակը չուղարկվեց։ Փորձեք մի փոքր հետո։");
  }
}
