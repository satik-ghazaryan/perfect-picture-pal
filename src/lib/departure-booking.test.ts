import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decideDepartureBooking,
  departureTotal,
  groupSeatNumbers,
  LEGACY_MANY,
  LEGACY_NO_DATE,
  LEGACY_NONE,
  listBookableDepartures,
  partySize,
  planLegacyBookingLinks,
  quoteChanged,
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
        { id: "later", tourId: "1-ui", departureDate: "2026-11-15", availableSeats: 2, price: 1000 },
        { id: "soon", tourId: "1-ui", departureDate: "2026-11-14", availableSeats: 3, price: 1000 },
      ],
      "2026-11-07",
    );
    assert.deepEqual(rows.map((row) => row.id), ["soon", "later"]);
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
    if (first.decision.result === "booked") assert.deepEqual(groupSeatNumbers(first.decision.firstSeat, 1), [1]);
    assert.equal(second.decision.result, "sold_out");
    assert.equal(repeat.decision.result, "repeat");
    assert.equal(first.state.seats, 0);
  });

  it("links a legacy booking only when the tour date matches one departure", () => {
    const planned = planLegacyBookingLinks(
      [
        { id: "linked", tourId: "tour", ticketCode: "AG-LINKED", departureId: "keep" },
        { id: "clear", tourId: "tour", ticketCode: "AG-CLEAR", departureId: null },
        { id: "ambiguous", tourId: "mixed", ticketCode: "AG-MIXED", departureId: null },
        { id: "undated", tourId: "open", ticketCode: "AG-OPEN", departureId: null },
      ],
      [
        { id: "tour", departureDate: "2026-11-14" },
        { id: "mixed", departureDate: "2026-11-14" },
        { id: "open", departureDate: null },
      ],
      [
        { id: "nov14", tourId: "tour", departureDate: "2026-11-14" },
        { id: "nov15", tourId: "tour", departureDate: "2026-11-15" },
        { id: "mixed-a", tourId: "mixed", departureDate: "2026-11-14" },
        { id: "mixed-b", tourId: "mixed", departureDate: "2026-11-14" },
      ],
    );
    assert.deepEqual(planned.links, [{ bookingId: "clear", departureId: "nov14" }]);
    assert.equal(planned.conflicts.find((item) => item.bookingId === "ambiguous")?.reason, LEGACY_MANY);
    assert.equal(planned.conflicts.find((item) => item.bookingId === "undated")?.reason, LEGACY_NO_DATE);
    assert.equal(planned.conflicts.some((item) => item.bookingId === "linked"), false);
    assert.equal(planLegacyBookingLinks(
      [{ id: "missing", tourId: "tour", ticketCode: "AG-MISS", departureId: null }],
      [{ id: "tour", departureDate: "2026-12-01" }],
      [{ id: "nov14", tourId: "tour", departureDate: "2026-11-14" }],
    ).conflicts[0]?.reason, LEGACY_NONE);
  });
});
