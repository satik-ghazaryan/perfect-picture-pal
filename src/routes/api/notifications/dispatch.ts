import { createFileRoute } from "@tanstack/react-router";
import { deliverNotification } from "@/lib/notification-gateway";
import type { NotificationChannel } from "@/lib/notifications";

function paymentSecret() {
  if (typeof process === "undefined" || !process.env) return "";
  return process.env["PAYMENT_SECRET"]?.trim() || "";
}

export const Route = createFileRoute("/api/notifications/dispatch")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = paymentSecret();
        if (!secret || request.headers.get("x-payment-secret") !== secret) {
          return Response.json({ mode: "failed" }, { status: 401 });
        }
        let payload: { channel?: NotificationChannel; phone?: string; body?: string };
        try {
          payload = (await request.json()) as { channel?: NotificationChannel; phone?: string; body?: string };
        } catch {
          return Response.json({ mode: "failed" }, { status: 400 });
        }
        const channel = payload.channel;
        const phone = typeof payload.phone === "string" ? payload.phone.trim() : "";
        const body = typeof payload.body === "string" ? payload.body.trim() : "";
        if ((channel !== "sms" && channel !== "whatsapp") || phone.replace(/\D/g, "").length < 8 || !body || body.length > 2000) {
          return Response.json({ mode: "failed" }, { status: 400 });
        }
        const mode = await deliverNotification(channel, phone, body);
        return Response.json({ mode }, { status: mode === "failed" ? 502 : 200 });
      },
    },
  },
});
