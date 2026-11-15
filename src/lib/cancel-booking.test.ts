import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canCancelBooking } from "@/lib/guide-api";

describe("cancelling a booking", () => {
  // 2026-11-20 08:00 in Yerevan (UTC+4) is 04:00 UTC.
  const departure = Date.parse("2026-11-20T04:00:00Z");
  const hour = 60 * 60 * 1000;

  it("is allowed more than 24 hours before departure", () => {
    assert.equal(canCancelBooking("2026-11-20", "08:00", departure - 25 * hour), true);
    assert.equal(canCancelBooking("2026-11-20", "08:00:00", departure - 48 * hour), true);
  });

  it("is refused within 24 hours or after departure", () => {
    assert.equal(canCancelBooking("2026-11-20", "08:00", departure - 24 * hour), false);
    assert.equal(canCancelBooking("2026-11-20", "08:00", departure - 3 * hour), false);
    assert.equal(canCancelBooking("2026-11-20", "08:00", departure + hour), false);
  });

  it("is refused when the date or time is unknown", () => {
    assert.equal(canCancelBooking("", "08:00", 0), false);
    assert.equal(canCancelBooking("2026-11-20", "", 0), false);
  });
});
