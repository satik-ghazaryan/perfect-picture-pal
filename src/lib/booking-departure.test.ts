import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bookingDayAssigned,
  bookingDepartureLabel,
  bookingTicketDateLabel,
  confirmBookingIfDayAssigned,
  nextAssignedDeparture,
  UNASSIGNED_SCHEDULE_LABEL,
} from "./booking-departure";

describe("booking departure", () => {
  it("shows an unassigned label and rejects confirmation without calling checkout", async () => {
    assert.equal(bookingDayAssigned(""), false);
    assert.equal(nextAssignedDeparture(""), null);
    assert.equal(bookingDepartureLabel(""), UNASSIGNED_SCHEDULE_LABEL);
    assert.equal(bookingTicketDateLabel(""), UNASSIGNED_SCHEDULE_LABEL);
    let called = 0;
    const result = await confirmBookingIfDayAssigned("", async () => {
      called += 1;
      return { ticket: "AG-1" };
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.message, UNASSIGNED_SCHEDULE_LABEL);
    assert.equal(called, 0);
  });

  it("keeps the existing saturday and sunday date calculation", () => {
    const friday = new Date(2026, 10, 6, 12, 0, 0);
    const saturday = nextAssignedDeparture("saturday", friday);
    const sunday = nextAssignedDeparture("sunday", friday);
    assert.ok(saturday);
    assert.ok(sunday);
    assert.equal(saturday.getDay(), 6);
    assert.equal(sunday.getDay(), 0);
    assert.equal(saturday.getFullYear(), 2026);
    assert.equal(saturday.getMonth(), 10);
    assert.equal(saturday.getDate(), 7);
    assert.equal(sunday.getDate(), 8);
    assert.match(bookingDepartureLabel("saturday", friday), /շաբաթ/i);
    assert.notEqual(bookingDepartureLabel("saturday", friday), UNASSIGNED_SCHEDULE_LABEL);
  });

  it("rejects confirmation if the day becomes unassigned after the form opened", async () => {
    let day: "" | "saturday" | "sunday" = "saturday";
    let called = 0;
    const opened = await confirmBookingIfDayAssigned(day, async () => {
      called += 1;
      return "opened";
    });
    assert.equal(opened.ok, true);
    day = "";
    const later = await confirmBookingIfDayAssigned(day, async () => {
      called += 1;
      return "should-not-run";
    });
    assert.equal(later.ok, false);
    assert.equal(called, 1);
  });
});
