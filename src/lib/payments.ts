import { peekNextSeat, registerBooking } from "@/lib/guide-api";
import { accountForPhone, commitLoyalty, loadLoyalty, quoteCheckout, revertLoyalty } from "@/lib/loyalty";
import {
  formatSeatNumbers,
  publishBookingNotices,
  sendBookingSMS,
  sendBookingWhatsApp,
  type DeliveryMode,
  type TicketDetails,
} from "@/lib/notifications";

export const PAYMENT_STATUSES = ["SUCCESS", "FAILED", "PENDING"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export type PaymentProvider = "idram" | "telcell" | "arca";

export type PaymentNoticeResult = {
  sms: DeliveryMode;
  whatsapp: DeliveryMode;
};

export type BookingNotice = {
  phone: string;
  customerName: string;
  tourName: string;
  tourId: string;
  ticketCode: string;
  seatNumbers: string;
  departureTime: string;
};

export type PaymentResult = {
  status: PaymentStatus;
  provider: PaymentProvider;
  billNo: string;
  amount: number;
  message: string;
  notification?: PaymentNoticeResult;
};

const PROVIDERS: Record<PaymentProvider, { label: string; path: string }> = {
  idram: { label: "Idram", path: "/api/payment/idram-callback" },
  telcell: { label: "Telcell", path: "/api/payment/telcell-callback" },
  arca: { label: "ArCa / Visa", path: "/api/payment/arca-callback" },
};

function paymentSecret() {
  return import.meta.env.VITE_PAYMENT_SECRET || "ari-gnank-demo";
}

export function paymentChecksum(provider: PaymentProvider, billNo: string, amount: number) {
  const raw = `${paymentSecret()}|${provider}|${billNo}|${amount}`;
  let hash = 2166136261;
  for (let index = 0; index < raw.length; index += 1) {
    hash ^= raw.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

export function providerLabel(provider: PaymentProvider) {
  return PROVIDERS[provider].label;
}

export function gatewayCallbackPath(provider: PaymentProvider) {
  return PROVIDERS[provider].path;
}

function field(body: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = body[key];
    if (value !== undefined && value !== null && String(value) !== "") return value;
  }
  return undefined;
}

function asAmount(value: unknown) {
  const amount = typeof value === "number" ? value : Number(value);
  return Number.isFinite(amount) ? Math.round(amount) : Number.NaN;
}

function failed(provider: PaymentProvider, billNo: string, amount: number, message: string): PaymentResult {
  return { status: "FAILED", provider, billNo, amount, message };
}

export function interpretCallback(provider: PaymentProvider, body: Record<string, unknown>): PaymentResult {
  const label = providerLabel(provider);
  const billNo = String(
    field(body, "EDP_BILL_NO", "issuer_id", "invoice", "orderNumber", "orderId", "billNo") ?? "",
  ).trim();
  const amount = asAmount(field(body, "EDP_AMOUNT", "sum", "amount"));
  const checksum = String(field(body, "EDP_CHECKSUM", "checksum") ?? "");

  if (!billNo || !Number.isFinite(amount) || amount < 0) {
    return failed(provider, billNo, 0, `${label} հարցումը թերի է։`);
  }
  if (checksum !== paymentChecksum(provider, billNo, amount)) {
    return failed(provider, billNo, amount, `${label} ստորագրությունը չհամընկավ։`);
  }

  const precheck = String(field(body, "EDP_PRECHECK", "phase") ?? "").toUpperCase();
  const telcell = String(field(body, "status") ?? "").toUpperCase();
  const arca = String(field(body, "orderStatus") ?? "");

  if (precheck === "YES" || precheck === "PRECHECK" || telcell === "NEW" || arca === "0") {
    return {
      status: "PENDING",
      provider,
      billNo,
      amount,
      message: `${label} վճարումը սպասման մեջ է։`,
    };
  }
  if (telcell === "REJECTED" || arca === "6" || String(field(body, "gatewayStatus") ?? "") === "FAILED") {
    return failed(provider, billNo, amount, `${label} վճարումը մերժվեց։`);
  }
  if (telcell === "PAID" || arca === "2" || precheck === "" || precheck === "CONFIRM") {
    return {
      status: "SUCCESS",
      provider,
      billNo,
      amount,
      message: `${label} վճարումը հաստատվեց։`,
    };
  }
  return failed(provider, billNo, amount, `${label} կարգավիճակը անհայտ է։`);
}

function textField(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
}

function readNotice(value: unknown): BookingNotice | null {
  if (!value || typeof value !== "object") return null;
  const notice = value as Record<string, unknown>;
  const phone = textField(notice, "phone");
  const customerName = textField(notice, "customerName");
  const tourName = textField(notice, "tourName");
  const tourId = textField(notice, "tourId");
  const ticketCode = textField(notice, "ticketCode");
  const seatNumbers = textField(notice, "seatNumbers");
  const departureTime = textField(notice, "departureTime");
  if (!phone || !customerName || !tourName || !tourId || !ticketCode || !seatNumbers || !departureTime) {
    return null;
  }
  return { phone, customerName, tourName, tourId, ticketCode, seatNumbers, departureTime };
}

function noticeDetails(notice: BookingNotice): TicketDetails {
  return {
    customerName: notice.customerName,
    tourName: notice.tourName,
    tourId: notice.tourId,
    ticketCode: notice.ticketCode,
    seatNumbers: notice.seatNumbers,
    departureTime: notice.departureTime,
  };
}

async function readPayload(provider: PaymentProvider, request: Request) {
  const url = new URL(request.url);
  const payload: Record<string, unknown> = {};
  if (request.method === "GET") {
    url.searchParams.forEach((value, key) => {
      payload[key] = value;
    });
    return payload;
  }
  const contentType = request.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      const json = (await request.json()) as Record<string, unknown>;
      if (json && typeof json === "object") Object.assign(payload, json);
    } else {
      const form = await request.formData();
      form.forEach((value, key) => {
        payload[key] = typeof value === "string" ? value : value.name;
      });
    }
  } catch {
    return failed(provider, "", 0, `${providerLabel(provider)} հարցումը թերի է։`);
  }
  return payload;
}

export async function readCallbackRequest(provider: PaymentProvider, request: Request) {
  const payload = await readPayload(provider, request);
  if ("status" in payload && "provider" in payload && "message" in payload) {
    return payload as PaymentResult;
  }
  return interpretCallback(provider, payload);
}

export async function respondToCallback(provider: PaymentProvider, request: Request): Promise<PaymentResult> {
  const payload = await readPayload(provider, request);
  if ("status" in payload && "provider" in payload && "message" in payload && !("EDP_BILL_NO" in payload)) {
    return payload as PaymentResult;
  }
  const result = interpretCallback(provider, payload);
  if (result.status !== "SUCCESS") return result;
  const notice = readNotice(payload["notification"]);
  if (!notice) return result;
  try {
    const details = noticeDetails(notice);
    const sms = await sendBookingSMS(notice.phone, details);
    const whatsapp = await sendBookingWhatsApp(notice.phone, details);
    return { ...result, notification: { sms: sms.mode, whatsapp: whatsapp.mode } };
  } catch {
    return { ...result, notification: { sms: "failed", whatsapp: "failed" } };
  }
}

function callbackBody(provider: PaymentProvider, billNo: string, amount: number, phase: "precheck" | "confirm") {
  const checksum = paymentChecksum(provider, billNo, amount);
  if (provider === "idram") {
    return {
      EDP_BILL_NO: billNo,
      EDP_AMOUNT: amount,
      EDP_REC_ACCOUNT: "110001237",
      EDP_CHECKSUM: checksum,
      ...(phase === "precheck" ? { EDP_PRECHECK: "YES" } : { EDP_TRANS_ID: `SIM-${billNo}` }),
    };
  }
  if (provider === "telcell") {
    return {
      invoice: billNo,
      issuer_id: billNo,
      sum: amount,
      checksum,
      status: phase === "precheck" ? "NEW" : "PAID",
    };
  }
  return {
    orderNumber: billNo,
    amount,
    checksum,
    orderStatus: phase === "precheck" ? "0" : "2",
  };
}

async function postCallback(
  provider: PaymentProvider,
  billNo: string,
  amount: number,
  phase: "precheck" | "confirm",
  notice?: BookingNotice,
) {
  const body = callbackBody(provider, billNo, amount, phase);
  const payload = notice ? { ...body, notification: notice } : body;
  const response = await fetch(gatewayCallbackPath(provider), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(payload),
  });
  const result = (await response.json()) as PaymentResult;
  if (!result || !PAYMENT_STATUSES.includes(result.status)) {
    throw new Error("Վճարման պատասխանը անհասկանալի է։");
  }
  return result;
}

export type CheckoutSuccess = {
  ok: true;
  status: "SUCCESS";
  provider: PaymentProvider | null;
  ticketCode: string;
  seatNumber: number;
  payable: number;
  redeemed: number;
  earned: number;
  points: number;
  pointsSaved: boolean;
  notified: boolean;
  coveredByPoints: boolean;
};

export type CheckoutFailure = {
  ok: false;
  status: "FAILED" | "PENDING";
  message: string;
};

export async function completeCheckout(input: {
  provider: PaymentProvider | null;
  tourId: string;
  tourTitle: string;
  passengerName: string;
  phone: string;
  adults: number;
  children: number;
  total: number;
  usePoints: boolean;
  balance: number;
  notify: boolean;
  departureTime: string;
}): Promise<CheckoutSuccess | CheckoutFailure> {
  let balance = input.balance;
  try {
    const account = await loadLoyalty(input.phone);
    balance = account.points;
  } catch {
    balance = input.balance;
  }
  const quote = quoteCheckout(balance, input.total, input.usePoints);
  if (input.usePoints && quote.redeem < 1) {
    return { ok: false, status: "FAILED", message: "Միավորները բավարար չեն։" };
  }
  if (quote.payable > 0 && !input.provider) {
    return { ok: false, status: "FAILED", message: "Ընտրեք վճարման եղանակը։" };
  }

  let points = balance;
  let undo: (() => Promise<void>) | null = null;
  const fail = async (status: "FAILED" | "PENDING", message: string): Promise<CheckoutFailure> => {
    if (!undo) return { ok: false, status, message };
    try {
      await undo();
    } catch (reason) {
      return {
        ok: false,
        status: "FAILED",
        message: reason instanceof Error ? reason.message : "Միավորները չվերականգնվեցին։",
      };
    }
    return { ok: false, status, message };
  };

  if (quote.redeem > 0 || quote.earn > 0) {
    const previous = accountForPhone(input.phone);
    try {
      const account = await commitLoyalty({
        phone: input.phone,
        fullName: input.passengerName,
        redeem: quote.redeem,
        earn: quote.earn,
        tourId: input.tourId,
        tourTitle: input.tourTitle,
        cashbackPercent: quote.cashbackPercent,
      });
      points = account.points;
    } catch (reason) {
      return {
        ok: false,
        status: "FAILED",
        message: reason instanceof Error ? reason.message : "Միավորները չգրանցվեցին։ Ամրագրումը չի ստեղծվել։",
      };
    }
    undo = () =>
      revertLoyalty({
        phone: input.phone,
        previous,
        redeem: quote.redeem,
        earn: quote.earn,
        tourId: input.tourId,
      });
  }

  const prefix = input.tourId.slice(0, 3).toUpperCase();
  const ticketCode = `AG-${prefix}-${Math.floor(100000 + Math.random() * 900000)}`;
  const seatNumbers = formatSeatNumbers(peekNextSeat(input.tourId), input.adults + input.children);
  const notice: BookingNotice = {
    phone: input.phone.trim(),
    customerName: input.passengerName.trim(),
    tourName: input.tourTitle,
    tourId: input.tourId,
    ticketCode,
    seatNumbers,
    departureTime: input.departureTime,
  };

  let confirmed: PaymentResult;
  if (quote.payable === 0) {
    confirmed = {
      status: "SUCCESS",
      provider: input.provider ?? "idram",
      billNo: ticketCode,
      amount: 0,
      message: "Տուրն ծածկված է միավորներով։",
    };
  } else {
    const provider = input.provider;
    if (!provider) return fail("FAILED", "Ընտրեք վճարման եղանակը։");
    try {
      const pending = await postCallback(provider, ticketCode, quote.payable, "precheck");
      if (pending.status === "FAILED") return fail("FAILED", pending.message);
      confirmed = await postCallback(provider, ticketCode, quote.payable, "confirm");
    } catch (reason) {
      return fail(
        "FAILED",
        reason instanceof Error ? reason.message : "Վճարման ծառայությունը անհասանելի է։",
      );
    }
  }

  if (confirmed.status !== "SUCCESS") {
    return fail(confirmed.status, confirmed.message);
  }

  let booking;
  try {
    booking = await registerBooking({
      tourId: input.tourId,
      passengerName: input.passengerName,
      phone: input.phone,
      adults: input.adults,
      children: input.children,
      ticketCode,
      paymentProvider: quote.payable === 0 ? null : input.provider,
      paymentStatus: "SUCCESS",
      amount: quote.payable,
    });
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : "Ամրագրումը չպահպանվեց։";
    return fail("FAILED", undo ? `${message} Միավորները վերականգնվեցին։` : message);
  }

  let notified = false;
  if (input.notify) {
    const details: TicketDetails = {
      customerName: notice.customerName,
      tourName: notice.tourName,
      tourId: notice.tourId,
      ticketCode: booking.ticketCode,
      seatNumbers: formatSeatNumbers(booking.seatNumber, input.adults + input.children),
      departureTime: input.departureTime,
    };
    try {
      if (confirmed.notification) {
        publishBookingNotices(input.phone, details, confirmed.notification);
        notified = confirmed.notification.sms !== "failed" || confirmed.notification.whatsapp !== "failed";
      } else {
        const sms = await sendBookingSMS(input.phone, details);
        const whatsapp = await sendBookingWhatsApp(input.phone, details);
        notified = sms.mode !== "failed" || whatsapp.mode !== "failed";
      }
    } catch {
      /* The passenger still has the ticket on screen. */
    }
  }

  return {
    ok: true,
    status: "SUCCESS",
    provider: quote.payable === 0 ? null : input.provider,
    ticketCode: booking.ticketCode,
    seatNumber: booking.seatNumber,
    payable: quote.payable,
    redeemed: quote.redeem,
    earned: quote.earn,
    points,
    pointsSaved: true,
    notified,
    coveredByPoints: quote.payable === 0 && quote.redeem > 0,
  };
}
