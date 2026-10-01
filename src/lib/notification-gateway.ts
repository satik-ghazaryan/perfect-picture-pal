import type { NotificationChannel } from "@/lib/notifications";

export type DeliveryMode = "mock" | "live" | "failed";

type GatewayConfig = {
  sid: string;
  token: string;
  from: string;
  whatsappFrom: string;
  smsWebhook: string;
  whatsappWebhook: string;
};

function envValue(name: string) {
  if (typeof process === "undefined" || !process.env) return "";
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
}

function gatewayConfig(): GatewayConfig {
  return {
    sid: envValue("VITE_TWILIO_ACCOUNT_SID"),
    token: envValue("VITE_TWILIO_AUTH_TOKEN"),
    from: envValue("VITE_TWILIO_PHONE_NUMBER"),
    whatsappFrom: envValue("VITE_TWILIO_WHATSAPP_NUMBER"),
    smsWebhook: envValue("VITE_SMS_GATEWAY_URL"),
    whatsappWebhook: envValue("VITE_WHATSAPP_GATEWAY_URL"),
  };
}

export function toE164(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("374")) return `+${digits}`;
  if (digits.startsWith("0") && digits.length === 9) return `+374${digits.slice(1)}`;
  if (digits.length === 8) return `+374${digits}`;
  return digits ? `+${digits}` : "";
}

function twilioReady(config: GatewayConfig) {
  return Boolean(config.sid && config.token && config.from);
}

async function postWebhook(url: string, payload: { channel: NotificationChannel; to: string; body: string }) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Gateway ${response.status}`);
  }
}

async function postTwilio(config: GatewayConfig, channel: NotificationChannel, phone: string, body: string) {
  const to = toE164(phone);
  const whatsappFrom = config.whatsappFrom || config.from;
  const from =
    channel === "whatsapp"
      ? whatsappFrom.startsWith("whatsapp:")
        ? whatsappFrom
        : `whatsapp:${whatsappFrom}`
      : config.from;
  const destination = channel === "whatsapp" ? `whatsapp:${to}` : to;
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${config.sid}/Messages.json`,
    {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${config.sid}:${config.token}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: destination, From: from, Body: body }),
    },
  );
  if (!response.ok) {
    throw new Error(`Twilio ${response.status}`);
  }
}

export async function deliverNotification(
  channel: NotificationChannel,
  phone: string,
  body: string,
): Promise<DeliveryMode> {
  const config = gatewayConfig();
  try {
    if (channel === "sms" && config.smsWebhook) {
      await postWebhook(config.smsWebhook, { channel, to: toE164(phone), body });
      return "live";
    }
    if (channel === "whatsapp" && config.whatsappWebhook) {
      await postWebhook(config.whatsappWebhook, { channel, to: toE164(phone), body });
      return "live";
    }
    if (twilioReady(config)) {
      await postTwilio(config, channel, phone, body);
      return "live";
    }
    if (channel === "whatsapp" && config.smsWebhook) {
      await postWebhook(config.smsWebhook, { channel, to: toE164(phone), body });
      return "live";
    }
    console.info(`[Արի Գնանք ${channel}]`, { to: phone, body });
    return "mock";
  } catch (error) {
    console.error(`[Արի Գնանք ${channel}]`, error);
    return "failed";
  }
}
