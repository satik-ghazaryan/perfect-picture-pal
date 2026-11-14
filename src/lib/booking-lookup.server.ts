import { createClient } from "@supabase/supabase-js";
import { findGuestBooking, type LookupBookingRow } from "@/lib/booking-lookup";
import { clientAddress } from "@/lib/tour-chat.server";

const WINDOW_MS = 60_000;
const LIMIT = 8;
const hits = new Map<string, number[]>();

function allowed(key: string, now = Date.now()) {
  const recent = (hits.get(key) ?? []).filter((time) => time > now - WINDOW_MS);
  if (recent.length >= LIMIT) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) hits.clear();
  return true;
}

function envValue(name: string) {
  if (typeof process === "undefined" || !process.env) return "";
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
}

function serviceClient() {
  const url = envValue("SUPABASE_URL") || envValue("VITE_SUPABASE_URL");
  const key = envValue("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function reply(status: number, body: unknown) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

/** Public: anyone who knows both the ticket code and the phone it was booked with sees that one booking. */
export async function handleBookingLookup(request: Request) {
  if (!allowed(clientAddress(request))) {
    return reply(429, { error: "Շատ փորձեր եղան։ Սպասեք մեկ րոպե և փորձեք նորից։" });
  }
  const service = serviceClient();
  if (!service) return reply(503, { error: "Ամրագրման որոնումը հիմա հասանելի չէ։" });
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return reply(422, { error: "Հարցումը թերի է։" });
  }
  const body = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const text = (value: unknown) => (typeof value === "string" ? value.slice(0, 60) : "");
  const result = await findGuestBooking(
    { ticketCode: text(body["ticketCode"]), phone: text(body["phone"]) },
    {
      loadBookings: async (ticketCode) => {
        const { data, error } = await service
          .from("bookings")
          .select(
            "ticket_code, passenger_name, phone, tour_id, departure_id, seat_number, adults, children, status, payment_status, amount",
          )
          .eq("ticket_code", ticketCode)
          .limit(40);
        if (error) throw new Error("booking lookup failed");
        return (data ?? []).map((row): LookupBookingRow => {
          const item = row as Record<string, unknown>;
          const number = (value: unknown) => (typeof value === "number" ? value : 0);
          const string = (value: unknown) => (typeof value === "string" ? value : "");
          return {
            ticketCode: string(item["ticket_code"]),
            passengerName: string(item["passenger_name"]),
            phone: string(item["phone"]),
            tourId: string(item["tour_id"]) || null,
            departureId: string(item["departure_id"]) || null,
            seatNumber: number(item["seat_number"]),
            adults: number(item["adults"]),
            children: number(item["children"]),
            status: string(item["status"]),
            paymentStatus: string(item["payment_status"]) || null,
            amount: number(item["amount"]),
          };
        });
      },
      loadDeparture: async (id) => {
        const { data, error } = await service
          .from("departures")
          .select("departure_date, guide_id, driver_id")
          .eq("id", id)
          .maybeSingle();
        if (error) throw new Error("departure lookup failed");
        if (!data) return null;
        const row = data as {
          departure_date: string;
          guide_id: string | null;
          driver_id: string | null;
        };
        return {
          departureDate: row.departure_date,
          guideId: row.guide_id,
          driverId: row.driver_id,
        };
      },
      loadTour: async (id) => {
        const { data, error } = await service
          .from("tours")
          .select("title_hy, departure_time, departure_place")
          .eq("id", id)
          .maybeSingle();
        if (error) throw new Error("tour lookup failed");
        if (!data) return null;
        const row = data as {
          title_hy: string | null;
          departure_time: string | null;
          departure_place: string | null;
        };
        return {
          title: row.title_hy ?? "",
          departureTime: row.departure_time ?? "",
          departurePlace: row.departure_place ?? "",
        };
      },
      // Name and photo only. A crew member's phone and email never leave the server here.
      loadStaff: async (id, role) => {
        const { data, error } = await service
          .from("profiles")
          .select("full_name, avatar_url, role")
          .eq("id", id)
          .maybeSingle();
        if (error) throw new Error("staff lookup failed");
        const row = data as {
          full_name: string | null;
          avatar_url: string | null;
          role: string | null;
        } | null;
        if (!row || row.role !== role) return null;
        return { fullName: row.full_name ?? "", avatarUrl: row.avatar_url ?? "" };
      },
    },
  );
  if (!result.ok) {
    const status = result.code === "invalid" ? 422 : result.code === "not_found" ? 404 : 500;
    return reply(status, { error: result.message });
  }
  return reply(200, { booking: result.booking });
}
