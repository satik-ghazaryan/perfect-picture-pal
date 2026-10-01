const STORAGE_KEY = "ari-gnank-notifications";

export type NotificationChannel = "sms" | "whatsapp";
export type NotificationStatus = "sent" | "failed";

export type TicketNotification = {
  id: string;
  channel: NotificationChannel;
  to: string;
  body: string;
  ticketCode: string;
  ticketUrl: string;
  audioUrl: string;
  status: NotificationStatus;
  sentAt: string;
};

type NotificationState = {
  items: TicketNotification[];
};

const emptyState: NotificationState = { items: [] };
let state: NotificationState = emptyState;
let hydrated = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function persist() {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* The message is still kept in memory for this page. */
  }
}

export function hydrateNotifications() {
  if (hydrated || typeof sessionStorage === "undefined") return;
  hydrated = true;
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as NotificationState;
    if (!parsed || !Array.isArray(parsed.items)) return;
    state = { items: parsed.items };
    emit();
  } catch {
    /* Ignore a damaged outbox. */
  }
}

export function subscribeNotifications(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getNotificationSnapshot() {
  return state;
}

export function getNotificationServerSnapshot() {
  return emptyState;
}

export function notificationsForPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return [];
  return state.items.filter((item) => item.to.replace(/\D/g, "") === digits);
}

function siteOrigin() {
  if (typeof window === "undefined") return "";
  return window.location.origin;
}

export type DeliveryMode = "mock" | "live" | "failed";

export type TicketDetails = {
  customerName: string;
  tourName: string;
  tourId: string;
  ticketCode: string;
  seatNumbers: string;
  departureTime: string;
};

export type ChannelReceipt = TicketNotification & {
  mode: DeliveryMode;
};

export function ticketLinks(tourId: string, ticketCode: string) {
  const origin = siteOrigin();
  const ticketUrl = `${origin}/tours/${tourId}?ticket=${encodeURIComponent(ticketCode)}`;
  const audioUrl = `${origin}/tours/${tourId}#audio`;
  return { ticketUrl, audioUrl };
}

export function formatSeatNumbers(start: number, count: number) {
  const total = Math.max(1, Math.floor(count));
  return Array.from({ length: total }, (_, index) => String(start + index)).join(", ");
}

export function bookingMessage(details: TicketDetails) {
  const links = ticketLinks(details.tourId, details.ticketCode);
  return [
    "Արի Գնանք",
    `Բարև, ${details.customerName}։ Ձեր ամրագրումը հաստատված է։`,
    `Տուր՝ ${details.tourName}`,
    `Նստատեղ՝ ${details.seatNumbers}`,
    `Մեկնում Արմավիրից՝ ${details.departureTime}`,
    `Թվային տոմս (QR)՝ ${links.ticketUrl}`,
    `Աուդիոգիդ (օֆլայն)՝ ${links.audioUrl}`,
  ].join("\n");
}

function browserGatewayConfigured() {
  const sid = import.meta.env.VITE_TWILIO_ACCOUNT_SID?.trim();
  const from = import.meta.env.VITE_TWILIO_PHONE_NUMBER?.trim();
  const smsWebhook = import.meta.env.VITE_SMS_GATEWAY_URL?.trim();
  const whatsappWebhook = import.meta.env.VITE_WHATSAPP_GATEWAY_URL?.trim();
  return Boolean(smsWebhook || whatsappWebhook || (sid && from));
}

function paymentSecret() {
  return import.meta.env.VITE_PAYMENT_SECRET || "ari-gnank-demo";
}

let lastMockToast = 0;

function queueMockToast() {
  if (typeof window === "undefined") return;
  const now = Date.now();
  if (now - lastMockToast < 1500) return;
  lastMockToast = now;
  void import("sonner").then(({ toast }) => {
    toast.success("Ծանուցումն ուղարկված է (Mock Mode)");
  });
}

function storeReceipt(receipt: TicketNotification) {
  state = { items: [receipt, ...state.items].slice(0, 40) };
  persist();
  emit();
}

async function deliver(channel: NotificationChannel, phone: string, body: string): Promise<DeliveryMode> {
  if (typeof window === "undefined") {
    const gateway = await import("@/lib/notification-gateway");
    return gateway.deliverNotification(channel, phone, body);
  }
  if (!browserGatewayConfigured()) return "mock";
  try {
    const response = await fetch("/api/notifications/dispatch", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "x-payment-secret": paymentSecret(),
      },
      body: JSON.stringify({ channel, phone, body }),
    });
    if (!response.ok) return "failed";
    const payload = (await response.json()) as { mode?: DeliveryMode };
    if (payload.mode === "live" || payload.mode === "mock" || payload.mode === "failed") return payload.mode;
    return "failed";
  } catch {
    return "failed";
  }
}

function makeReceipt(
  channel: NotificationChannel,
  phone: string,
  details: TicketDetails,
  body: string,
  mode: DeliveryMode,
): ChannelReceipt {
  const links = ticketLinks(details.tourId, details.ticketCode);
  return {
    id: crypto.randomUUID(),
    channel,
    to: phone,
    body,
    ticketCode: details.ticketCode,
    ticketUrl: links.ticketUrl,
    audioUrl: links.audioUrl,
    status: mode === "failed" ? "failed" : "sent",
    sentAt: new Date().toISOString(),
    mode,
  };
}

async function sendChannel(
  channel: NotificationChannel,
  phoneNumber: string,
  ticketDetails: TicketDetails,
): Promise<ChannelReceipt> {
  const phone = phoneNumber.trim();
  const body = bookingMessage(ticketDetails);
  if (phone.replace(/\D/g, "").length < 8) {
    const failed = makeReceipt(channel, phone, ticketDetails, body, "failed");
    if (typeof window !== "undefined") storeReceipt(failed);
    throw new Error("Հաստատումը չուղարկվեց. հեռախոսահամարը թերի է։");
  }
  const mode = await deliver(channel, phone, body);
  const receipt = makeReceipt(channel, phone, ticketDetails, body, mode);
  if (typeof window !== "undefined") {
    storeReceipt(receipt);
    if (mode === "mock") {
      console.info(`[Արի Գնանք ${channel}]`, { to: phone, body });
      queueMockToast();
    }
  }
  return receipt;
}

export function sendBookingSMS(phoneNumber: string, ticketDetails: TicketDetails) {
  return sendChannel("sms", phoneNumber, ticketDetails);
}

export function sendBookingWhatsApp(phoneNumber: string, ticketDetails: TicketDetails) {
  return sendChannel("whatsapp", phoneNumber, ticketDetails);
}

export function publishBookingNotices(
  phoneNumber: string,
  details: TicketDetails,
  modes: { sms: DeliveryMode; whatsapp: DeliveryMode },
) {
  const phone = phoneNumber.trim();
  const body = bookingMessage(details);
  const sms = makeReceipt("sms", phone, details, body, modes.sms);
  const whatsapp = makeReceipt("whatsapp", phone, details, body, modes.whatsapp);
  if (typeof window === "undefined") return { sms, whatsapp };
  state = { items: [whatsapp, sms, ...state.items].slice(0, 40) };
  persist();
  emit();
  if (modes.sms === "mock" || modes.whatsapp === "mock") {
    console.info("[Արի Գնանք] SMS/WhatsApp", {
      to: phone,
      sms: modes.sms,
      whatsapp: modes.whatsapp,
      body,
    });
    queueMockToast();
  }
  return { sms, whatsapp };
}
