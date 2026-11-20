// Settings for the ElevenLabs "call Ani" widget. Pure helpers so they can be unit tested.

export const VOICE_WIDGET_SCRIPT = "https://unpkg.com/@elevenlabs/convai-widget-embed";

const AGENT_ID = /^agent_[A-Za-z0-9]{8,64}$/;

/** Staff areas where a customer phone agent would only get in the way. */
const STAFF_PREFIXES = ["/admin", "/driver", "/guide", "/vendor", "/login", "/reset-password"];

/** Returns the agent id only when it looks like a real ElevenLabs id; otherwise the widget stays off. */
export function voiceAgentId(value: unknown) {
  if (typeof value !== "string") return null;
  const id = value.trim();
  return AGENT_ID.test(id) ? id : null;
}

export function showVoiceWidget(pathname: string) {
  return !STAFF_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** Armenian labels for the widget buttons and states. */
export const VOICE_WIDGET_TEXT = {
  "action-text": "Զանգահարել Անիին",
  "start-call-text": "Սկսել զրույցը",
  "end-call-text": "Ավարտել",
  "expand-text": "Բացել",
  "listening-text": "Լսում եմ...",
  "speaking-text": "Անին խոսում է",
} as const;
