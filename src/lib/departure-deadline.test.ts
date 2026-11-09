import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { departureBookingClosed, yerevanDepartureStart } from "./departure-deadline";

describe("Yerevan departure deadline", () => {
  const start = yerevanDepartureStart("2026-11-09", "13:04:13");

  it("reads the start as Asia/Yerevan and rejects a missing or invalid time", () => {
    assert.equal(start?.toISOString(), "2026-11-09T09:04:13.000Z");
    assert.equal(yerevanDepartureStart("2026-11-09", ""), null);
    assert.equal(yerevanDepartureStart("2026-11-09", "25:00"), null);
    assert.equal(yerevanDepartureStart("2026-11-09", "8:30"), null);
    assert.equal(departureBookingClosed("2026-11-09", ""), true);
    assert.equal(departureBookingClosed("2026-11-09", "no-time"), true);
  });

  it("stays open one second before the start and closes at the start instant", () => {
    assert.ok(start);
    assert.equal(departureBookingClosed("2026-11-09", "13:04:13", new Date(start.getTime() - 1000)), false);
    assert.equal(departureBookingClosed("2026-11-09", "13:04:13", start), true);
    assert.equal(departureBookingClosed("2026-11-09", "13:04:13", new Date(start.getTime() + 1000)), true);
  });
});
