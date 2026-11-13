import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { resetTicketNoticeCalls, ticketNoticeCallCount } from "./notifications";
import { paymentChecksum, respondToCallback } from "./payments";

const SECRET = "test-payment-secret";

function callback(headers: Record<string, string> = {}) {
  const billNo = "AG-GAR-123456";
  const amount = 5000;
  return new Request("https://example.test/api/payment/idram-callback", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({
      EDP_BILL_NO: billNo,
      EDP_AMOUNT: amount,
      EDP_CHECKSUM: paymentChecksum("idram", billNo, amount),
      notification: {
        phone: "+37499000000",
        customerName: "Անի",
        tourName: "Գառնի",
        tourId: "garni",
        ticketCode: billNo,
        seatNumbers: "1",
        departureTime: "09:00",
      },
    }),
  });
}

describe("payment callback notifications", () => {
  let previous: string | undefined;

  beforeEach(() => {
    previous = process.env["PAYMENT_SECRET"];
    resetTicketNoticeCalls();
  });

  afterEach(() => {
    if (previous === undefined) delete process.env["PAYMENT_SECRET"];
    else process.env["PAYMENT_SECRET"] = previous;
  });

  it("does not message anyone when the caller only has the public sandbox checksum", async () => {
    process.env["PAYMENT_SECRET"] = SECRET;
    const result = await respondToCallback("idram", callback());
    assert.equal(result.status, "SUCCESS");
    assert.equal(result.notification, undefined);
    assert.equal(ticketNoticeCallCount(), 0);
  });

  it("does not message anyone when the secret header is wrong", async () => {
    process.env["PAYMENT_SECRET"] = SECRET;
    const result = await respondToCallback("idram", callback({ "x-payment-secret": "guess" }));
    assert.equal(result.notification, undefined);
    assert.equal(ticketNoticeCallCount(), 0);
  });

  it("does not message anyone when the server has no secret configured", async () => {
    delete process.env["PAYMENT_SECRET"];
    const result = await respondToCallback("idram", callback({ "x-payment-secret": "" }));
    assert.equal(result.notification, undefined);
    assert.equal(ticketNoticeCallCount(), 0);
  });

  it("sends the ticket when the caller proves it knows the server secret", async () => {
    process.env["PAYMENT_SECRET"] = SECRET;
    const result = await respondToCallback("idram", callback({ "x-payment-secret": SECRET }));
    assert.equal(result.status, "SUCCESS");
    assert.ok(result.notification);
    assert.equal(ticketNoticeCallCount(), 2);
  });
});
