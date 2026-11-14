import { createFileRoute } from "@tanstack/react-router";
import { handleBookingLookup } from "@/lib/booking-lookup.server";
import { methodNotAllowed } from "@/lib/ideas-proxy.server";

export const Route = createFileRoute("/api/bookings/lookup")({
  server: {
    handlers: {
      POST: ({ request }) => handleBookingLookup(request),
      GET: async () => methodNotAllowed(),
      PUT: async () => methodNotAllowed(),
      PATCH: async () => methodNotAllowed(),
      DELETE: async () => methodNotAllowed(),
    },
  },
});
