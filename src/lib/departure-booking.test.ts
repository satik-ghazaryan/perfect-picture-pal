import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resetTicketNoticeCalls,
  sendBookingSMS,
  sendBookingWhatsApp,
  ticketNoticeCallCount,
} from "./notifications";
import {
  confirmationAccess,
  decideDepartureBooking,
  departureTotal,
  groupSeatNumbers,
  LEGACY_NO_DATE,
  LEGACY_UNVERIFIED_LINK,
  listBookableDepartures,
  orderFingerprint,
  partySize,
  planLegacyBookingLinks,
  quoteChanged,
  shouldDeliverTicket,
} from "./departure-booking";

const quote = {
  departureId: "dep-1",
  departureDate: "2026-11-14",
  unitPrice: 15000,
  availableSeats: 4,
  cashbackPercent: 5,
};

describe("departure booking", () => {
  it("lists only future departures that still have seats", () => {
    const rows = listBookableDepartures(
      [
        { id: "past", tourId: "1-ui", departureDate: "2026-11-01", availableSeats: 4, price: 1000 },
        { id: "full", tourId: "1-ui", departureDate: "2026-11-14", availableSeats: 0, price: 1000 },
        {
          id: "later",
          tourId: "1-ui",
          departureDate: "2026-11-15",
          availableSeats: 2,
          price: 1000,
        },
        { id: "soon", tourId: "1-ui", departureDate: "2026-11-14", availableSeats: 3, price: 1000 },
      ],
      "2026-11-07",
    );
    assert.deepEqual(
      rows.map((row) => row.id),
      ["soon", "later"],
    );
  });

  it("counts a group by adults and children and numbers consecutive seats", () => {
    assert.equal(partySize(2, 1), 3);
    assert.equal(partySize(0, 2), null);
    assert.equal(departureTotal(15000, 3), 45000);
    assert.deepEqual(groupSeatNumbers(4, 3), [4, 5, 6]);
  });

  it("asks for a new confirmation when the opened quote changed", () => {
    assert.equal(quoteChanged(quote, quote), false);
    assert.equal(quoteChanged(quote, { ...quote, unitPrice: 16000 }), true);
    assert.equal(quoteChanged(quote, { ...quote, availableSeats: 2 }), true);
    assert.equal(quoteChanged(quote, { ...quote, departureDate: "2026-11-16" }), true);
  });

  it("lets only one confirmation take the last seat and repeats the same key", () => {
    const first = decideDepartureBooking(
      { seats: 1, nextSeat: 1, keys: {} },
      { key: "one", party: 1, expectedSeats: 1 },
    );
    const second = decideDepartureBooking(first.state, { key: "two", party: 1, expectedSeats: 1 });
    const repeat = decideDepartureBooking(first.state, { key: "one", party: 1, expectedSeats: 1 });
    assert.equal(first.decision.result, "booked");
    if (first.decision.result === "booked")
      assert.deepEqual(groupSeatNumbers(first.decision.firstSeat, 1), [1]);
    assert.equal(second.decision.result, "sold_out");
    assert.equal(repeat.decision.result, "repeat");
    assert.equal(first.state.seats, 0);
  });

  it("does not treat the tour's current date as proof for an old booking", () => {
    const planned = planLegacyBookingLinks([
      {
        id: "checkout",
        tourId: "tour",
        ticketCode: "AG-NEW",
        departureId: "nov14",
        confirmed: true,
      },
      { id: "old", tourId: "tour", ticketCode: "AG-OLD", departureId: "current-date" },
      { id: "historical", tourId: "tour", ticketCode: "AG-HIST", departureId: null },
    ]);
    assert.deepEqual(planned.links, []);
    assert.equal(
      planned.conflicts.find((item) => item.bookingId === "historical")?.reason,
      LEGACY_NO_DATE,
    );
    assert.equal(
      planned.reviews.find((item) => item.bookingId === "old")?.reason,
      LEGACY_UNVERIFIED_LINK,
    );
    assert.equal(
      planned.reviews.some((item) => item.bookingId === "checkout"),
      false,
    );
  });

  it("repeats only the same booker and order, and does not send another ticket", async () => {
    const fingerprint = orderFingerprint({
      departureId: "dep",
      adults: 2,
      children: 1,
      phone: "+374 90 000311",
      name: "Անի",
      usePoints: false,
    });
    const stored = { booker: "guest", proof: "secret", fingerprint };
    assert.equal(confirmationAccess(null, stored), "create");
    assert.equal(confirmationAccess(stored, stored), "repeat");
    assert.equal(
      confirmationAccess(stored, { ...stored, fingerprint: `${fingerprint}x` }),
      "reject",
    );
    assert.equal(confirmationAccess(stored, { ...stored, booker: "user:other" }), "reject");
    assert.equal(shouldDeliverTicket(false, true), true);
    assert.equal(shouldDeliverTicket(true, true), false);
    const details = {
      customerName: "Անի",
      tourName: "Տուր",
      tourId: "1-ui",
      ticketCode: "AG-TEST",
      seatNumbers: "1",
      departureTime: "08:30",
    };
    resetTicketNoticeCalls();
    if (shouldDeliverTicket(false, true)) {
      await sendBookingSMS("12", details).catch(() => undefined);
      await sendBookingWhatsApp("12", details).catch(() => undefined);
    }
    assert.equal(ticketNoticeCallCount(), 2);
    if (shouldDeliverTicket(true, true)) {
      await sendBookingSMS("12", details).catch(() => undefined);
    }
    assert.equal(ticketNoticeCallCount(), 2);
  });
});
