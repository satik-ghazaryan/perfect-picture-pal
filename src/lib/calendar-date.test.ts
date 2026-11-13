import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  catalogDayFromRow,
  formatAssignedDepartureDate,
  isValidIsoDate,
  UNASSIGNED_DEPARTURE_LABEL,
  UNASSIGNED_SCHEDULE_LABEL,
  weekendDayFromIsoDate,
  weekendScheduleLabel,
  weekdayNameFromIsoDate,
} from "./calendar-date.ts";

describe("assigned departure dates", () => {
  it("does not throw on empty or invalid dates", () => {
    assert.equal(isValidIsoDate(""), false);
    assert.equal(isValidIsoDate("not-a-date"), false);
    assert.equal(formatAssignedDepartureDate(""), UNASSIGNED_DEPARTURE_LABEL);
    assert.equal(formatAssignedDepartureDate(undefined), UNASSIGNED_DEPARTURE_LABEL);
    assert.equal(formatAssignedDepartureDate("99-99-99"), UNASSIGNED_DEPARTURE_LABEL);
    assert.match(formatAssignedDepartureDate("2026-11-07"), /2026/);
  });

  it("infers sunday from a legacy date only when day is missing", () => {
    assert.equal(weekendDayFromIsoDate("2026-11-08"), "sunday");
    assert.equal(weekendDayFromIsoDate("2026-11-07"), "saturday");
    assert.equal(weekendDayFromIsoDate("2026-11-11"), null);
    assert.equal(catalogDayFromRow({ day: "saturday", departure_date: "2026-11-08" }), "saturday");
    assert.equal(catalogDayFromRow({ day: null, departure_date: "2026-11-08" }), "sunday");
    assert.equal(catalogDayFromRow({ day: null, departure_date: "2026-11-11" }), "");
    assert.equal(weekendScheduleLabel(""), UNASSIGNED_SCHEDULE_LABEL);
  });

  it("names every weekday from the selected date", () => {
    assert.equal(weekdayNameFromIsoDate("2026-11-13"), "ուրբաթ");
    assert.equal(weekdayNameFromIsoDate("2026-11-16"), "երկուշաբթի");
    assert.equal(weekdayNameFromIsoDate(""), "");
  });
});
