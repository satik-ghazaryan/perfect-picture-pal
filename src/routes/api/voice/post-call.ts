import { createFileRoute } from "@tanstack/react-router";
import {
  leadFromWebhook,
  leadMessage,
  leadNeedsOperator,
  verifyElevenLabsSignature,
} from "@/lib/voice-post-call";

// ElevenLabs post-call webhook. After each call with Ani, the collected lead
// (name, phone, tour, date, people) is sent to the operator's Telegram chat.
// Env (Vercel, server-only): ELEVENLABS_WEBHOOK_SECRET, TELEGRAM_BOT_TOKEN, TELEGRAM_OPERATOR_CHAT_ID.

const MAX_BODY = 2_000_000;

function envValue(name: string) {
  const value = typeof process !== "undefined" ? process.env?.[name] : undefined;
  return typeof value === "string" ? value.trim() : "";
}

function json(status: number, body: Record<string, unknown>) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

async function sendTelegram(token: string, chatId: string, text: string) {
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  return response.ok;
}

export const Route = createFileRoute("/api/voice/post-call")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = envValue("ELEVENLABS_WEBHOOK_SECRET");
        const token = envValue("TELEGRAM_BOT_TOKEN");
        const chatId = envValue("TELEGRAM_OPERATOR_CHAT_ID");
        if (!secret) return json(503, { error: "not_configured" });

        const raw = await request.text().catch(() => "");
        if (!raw || raw.length > MAX_BODY) return json(413, { error: "bad_body" });
        if (!verifyElevenLabsSignature(raw, request.headers.get("elevenlabs-signature"), secret)) {
          return json(401, { error: "invalid_signature" });
        }

        let event: unknown;
        try {
          event = JSON.parse(raw);
        } catch {
          return json(400, { error: "bad_json" });
        }
        const lead = leadFromWebhook(event);
        // Other event types and calls with nothing to follow up are acknowledged and dropped.
        if (!lead || !leadNeedsOperator(lead)) return json(200, { status: "ignored" });
        if (!token || !/^-?\d{3,20}$/.test(chatId)) return json(200, { status: "telegram_off" });

        const sent = await sendTelegram(token, chatId, leadMessage(lead)).catch(() => false);
        // A failed Telegram send returns 502 so ElevenLabs retries the webhook later.
        return sent ? json(200, { status: "sent" }) : json(502, { error: "telegram_failed" });
      },
    },
  },
});
