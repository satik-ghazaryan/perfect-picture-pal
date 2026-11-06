import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatAssignedDepartureDate,
  isValidIsoDate,
  UNASSIGNED_DEPARTURE_LABEL,
} from "./calendar-date";

describe("assigned departure dates", () => {
  it("does not throw on empty or invalid dates", () => {
    assert.equal(isValidIsoDate(""), false);
    assert.equal(isValidIsoDate("not-a-date"), false);
    assert.equal(formatAssignedDepartureDate(""), UNASSIGNED_DEPARTURE_LABEL);
    assert.equal(formatAssignedDepartureDate(undefined), UNASSIGNED_DEPARTURE_LABEL);
    assert.equal(formatAssignedDepartureDate("99-99-99"), UNASSIGNED_DEPARTURE_LABEL);
    assert.match(formatAssignedDepartureDate("2026-11-07"), /2026/);
  });
});
