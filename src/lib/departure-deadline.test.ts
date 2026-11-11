import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { departureBookingClosed, upcomingDepartures, yerevanDepartureStart } from "./departure-deadline.ts";

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

  it("hides a started departure and keeps a later sold-out one, nearest first", () => {
    const now = yerevanDepartureStart("2026-11-10", "12:00");
    assert.ok(now);
    const rows = upcomingDepartures(
      [
        { id: "past", tourId: "sevan", departureDate: "2026-10-08", availableSeats: 4, departureTime: "08:00" },
        { id: "started", tourId: "garni", departureDate: "2026-11-10", availableSeats: 2, departureTime: "08:00" },
        { id: "full", tourId: "tatev", departureDate: "2026-11-15", availableSeats: 0, departureTime: "07:00" },
        { id: "soon", tourId: "garni", departureDate: "2026-11-14", availableSeats: 3, departureTime: "08:30" },
      ],
      now,
    );
    assert.deepEqual(rows.map((row) => row.id), ["soon", "full"]);
    const today = {
      id: "today",
      tourId: "garni",
      departureDate: "2026-11-10",
      availableSeats: 1,
      departureTime: "08:00",
    };
    const todayStart = yerevanDepartureStart(today.departureDate, today.departureTime);
    assert.ok(todayStart);
    assert.equal(upcomingDepartures([today], new Date(todayStart.getTime() - 1000)).length, 1);
    assert.equal(upcomingDepartures([today], todayStart).length, 0);
  });
});
