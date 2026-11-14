import { supabase } from "@/lib/supabase";

/**
 * Bookings made on this device without an account. The browser keeps the secret it used,
 * so after the person signs in the booking can join their account (when the phones match).
 */
const STORAGE_KEY = "ari-gnank-guest-bookings";
const KEEP_MS = 120 * 24 * 60 * 60 * 1000;
const MAX_ITEMS = 50;
const TOKEN = /^[A-Za-z0-9_-]{16,80}$/;

export type GuestClaim = { key: string; proof: string; at: number };

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readGuestClaims(now = Date.now()): GuestClaim[] {
  const store = storage();
  if (!store) return [];
  try {
    const parsed: unknown = JSON.parse(store.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is GuestClaim =>
          !!item &&
          typeof item === "object" &&
          typeof (item as GuestClaim).key === "string" &&
          typeof (item as GuestClaim).proof === "string" &&
          typeof (item as GuestClaim).at === "number" &&
          TOKEN.test((item as GuestClaim).key) &&
          TOKEN.test((item as GuestClaim).proof),
      )
      .filter((item) => now - item.at < KEEP_MS)
      .slice(-MAX_ITEMS);
  } catch {
    return [];
  }
}

function writeGuestClaims(items: GuestClaim[]) {
  const store = storage();
  if (!store) return;
  try {
    if (items.length === 0) store.removeItem(STORAGE_KEY);
    else store.setItem(STORAGE_KEY, JSON.stringify(items.slice(-MAX_ITEMS)));
  } catch {
    // Storage full or blocked: linking by ticket code and phone still works.
  }
}

export function rememberGuestBooking(key: string, proof: string, now = Date.now()) {
  if (!TOKEN.test(key) || !TOKEN.test(proof)) return;
  const items = readGuestClaims(now).filter((item) => item.key !== key);
  items.push({ key, proof, at: now });
  writeGuestClaims(items);
}

/** Links this device's guest bookings to the signed-in tourist. Returns the linked ticket codes. */
export async function claimRememberedGuestBookings(): Promise<string[]> {
  const items = readGuestClaims();
  if (!supabase || items.length === 0) return [];
  const { data, error } = await supabase.rpc("claim_guest_bookings_by_proof", {
    p_items: items.map(({ key, proof }) => ({ key, proof })),
  });
  if (error || !data || typeof data !== "object") return [];
  const result = data as { ok?: boolean; linked?: unknown; done?: unknown };
  if (result.ok !== true) return [];
  const done = new Set(Array.isArray(result.done) ? result.done.map(String) : []);
  writeGuestClaims(items.filter((item) => !done.has(item.key)));
  return Array.isArray(result.linked) ? result.linked.map(String) : [];
}

export type ClaimResult = { ok: true; already: boolean } | { ok: false; message: string };

/** Links one booking by its ticket code and the phone it was booked with. */
export async function claimGuestBooking(ticketCode: string, phone: string): Promise<ClaimResult> {
  if (!supabase) return { ok: false, message: "Կապը հիմա հասանելի չէ։" };
  const { data, error } = await supabase.rpc("claim_guest_booking", {
    p_ticket_code: ticketCode.trim(),
    p_phone: phone.trim(),
  });
  if (error || !data || typeof data !== "object") {
    return { ok: false, message: "Ամրագրումը հիմա չկցվեց։ Փորձեք կրկին։" };
  }
  const result = data as { ok?: boolean; already?: boolean; message?: unknown };
  if (result.ok === true) return { ok: true, already: result.already === true };
  return {
    ok: false,
    message: typeof result.message === "string" ? result.message : "Ամրագրումը չկցվեց։",
  };
}
