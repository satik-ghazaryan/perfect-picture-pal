import { createHmac, timingSafeEqual } from "node:crypto";

// ElevenLabs post-call webhook → Telegram notice for the operator.
// Pure helpers (signature check, lead extraction, message text) so they can be unit tested.

/** ElevenLabs signs `${timestamp}.${rawBody}` with HMAC-SHA256; header is `t=<unix>,v0=<hex>`. */
export const SIGNATURE_TOLERANCE_SECONDS = 30 * 60;

export function verifyElevenLabsSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  if (!header || secret.length < 8) return false;
  const parts = new Map(
    header.split(",").flatMap((part) => {
      const index = part.indexOf("=");
      return index > 0
        ? [[part.slice(0, index).trim(), part.slice(index + 1).trim()] as const]
        : [];
    }),
  );
  const timestamp = Number(parts.get("t"));
  const given = parts.get("v0") ?? "";
  if (!Number.isInteger(timestamp) || !/^[0-9a-f]{64}$/i.test(given)) return false;
  if (Math.abs(nowSeconds - timestamp) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(given.toLowerCase(), "hex"));
}

export type VoiceLead = {
  conversationId: string;
  agentId: string;
  name: string;
  phone: string;
  tour: string;
  tourDate: string;
  people: string;
  interestedDirection: string;
  summary: string;
  durationSeconds: number | null;
};

function text(value: unknown, max = 300) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return "";
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.toLowerCase() === "null" || clean.toLowerCase() === "none"
    ? ""
    : clean.slice(0, max);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function collected(results: Record<string, unknown>, key: string) {
  return text(record(results[key])["value"]);
}

/** Reads a post_call_transcription event. Returns null for other events or malformed bodies. */
export function leadFromWebhook(event: unknown): VoiceLead | null {
  const root = record(event);
  if (root["type"] !== "post_call_transcription") return null;
  const data = record(root["data"]);
  const analysis = record(data["analysis"]);
  const results = record(analysis["data_collection_results"]);
  const metadata = record(data["metadata"]);
  const duration = metadata["call_duration_secs"];
  return {
    conversationId: text(data["conversation_id"], 80),
    agentId: text(data["agent_id"], 80),
    name: collected(results, "customer_name"),
    phone: collected(results, "phone"),
    tour: collected(results, "tour"),
    tourDate: collected(results, "tour_date"),
    people: collected(results, "people_count"),
    interestedDirection: collected(results, "interested_direction"),
    summary: text(analysis["transcript_summary"], 600),
    durationSeconds: typeof duration === "number" && Number.isFinite(duration) ? duration : null,
  };
}

/** Only calls that left a way to reach the caller, or a wish we should record, are worth a notice. */
export function leadNeedsOperator(lead: VoiceLead) {
  return Boolean(lead.phone || lead.name || lead.interestedDirection);
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function conversationUrl(conversationId: string) {
  return /^[A-Za-z0-9_-]{4,80}$/.test(conversationId)
    ? `https://elevenlabs.io/app/agents/history/${conversationId}`
    : "";
}

/** Telegram HTML message for the operator, in Armenian. */
export function leadMessage(lead: VoiceLead) {
  const lines = ["📞 <b>Նոր հայտ Անիից</b>", ""];
  const row = (label: string, value: string) => {
    if (value) lines.push(`<b>${label}՝</b> ${escapeHtml(value)}`);
  };
  row("Անուն", lead.name);
  row("Հեռախոս", lead.phone);
  row("Տուր", lead.tour);
  row("Ամսաթիվ", lead.tourDate);
  row("Մարդիկ", lead.people);
  row("Հետաքրքրված է", lead.interestedDirection);
  if (!lead.phone) lines.push("⚠️ Հեռախոսահամար չի թողել");
  if (lead.summary) lines.push("", `<i>${escapeHtml(lead.summary)}</i>`);
  const link = conversationUrl(lead.conversationId);
  if (link) lines.push("", `<a href="${link}">Լսել զանգը ElevenLabs-ում</a>`);
  return lines.join("\n").slice(0, 3900);
}
