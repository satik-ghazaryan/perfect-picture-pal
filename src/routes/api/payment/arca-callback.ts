import { createFileRoute } from "@tanstack/react-router";
import { respondToCallback, type PaymentResult } from "@/lib/payments";

function json(result: PaymentResult) {
  return Response.json(result, { status: result.status === "FAILED" ? 400 : 200 });
}

export const Route = createFileRoute("/api/payment/arca-callback")({
  server: {
    handlers: {
      GET: async ({ request }) => json(await respondToCallback("arca", request)),
      POST: async ({ request }) => json(await respondToCallback("arca", request)),
    },
  },
});
