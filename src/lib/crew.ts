import { isSupabaseConfigured, supabase } from "@/lib/supabase";

export type PublicStaffMember = {
  id: string;
  fullName: string;
  avatarUrl: string;
  role: "guide" | "driver";
};

export function publicStaffFromRow(row: {
  id: string;
  full_name: string;
  avatar_url: string | null;
  role: string;
}): PublicStaffMember | null {
  if (row.role !== "guide" && row.role !== "driver") return null;
  return {
    id: row.id,
    fullName: row.full_name,
    avatarUrl: row.avatar_url ?? "",
    role: row.role,
  };
}

/** Safe staff rows for the public catalog (anon and any logged-in non-admin). Never includes phone or email. */
export async function loadPublicStaff(): Promise<PublicStaffMember[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  const { data, error } = await supabase
    .from("public_staff")
    .select("id, full_name, avatar_url, role")
    .order("full_name");
  if (error || !data) return [];
  return data.flatMap((row) => {
    const staff = publicStaffFromRow(row);
    return staff ? [staff] : [];
  });
}

/** Milliseconds until a one-day tour leaves. Negative after departure. */
export function timeUntilDeparture(date: string, time: string, now = new Date()) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  const hours = match ? Number(match[1]) : 0;
  const minutes = match ? Number(match[2]) : 0;
  const at = new Date(`${date}T00:00:00`);
  if (Number.isNaN(at.getTime())) return null;
  at.setHours(hours, minutes, 0, 0);
  return at.getTime() - now.getTime();
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Guide and driver details open once the departure is 24 hours away or sooner. */
export function crewRevealed(date: string, time: string, now = new Date()) {
  const remaining = timeUntilDeparture(date, time, now);
  return remaining !== null && remaining <= DAY_MS;
}

export function formatTimeRemaining(remaining: number) {
  if (remaining <= 0) return "Մեկնումը սկսվել է";
  const totalMinutes = Math.floor(remaining / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `Մեկնմանը մնացել է ${days} օր${hours > 0 ? ` ${hours} ժամ` : ""}`;
  if (hours > 0) return `Մեկնմանը մնացել է ${hours} ժամ${minutes > 0 ? ` ${minutes} րոպե` : ""}`;
  return `Մեկնմանը մնացել է ${Math.max(minutes, 1)} րոպե`;
}
