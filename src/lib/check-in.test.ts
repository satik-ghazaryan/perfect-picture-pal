import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planPassengerCheckIn } from "./check-in";

describe("departure check-in", () => {
  it("marks the passenger present on the selected departure", () => {
    const plan = planPassengerCheckIn({
      assigned: true,
      foundOnDeparture: true,
      attendance: null,
      passengerName: "Անի",
    });
    assert.equal(plan.action, "mark");
    if (plan.action === "mark") assert.equal(plan.attendance, "present");
  });

  it("does not write again when the same ticket is already present", () => {
    const plan = planPassengerCheckIn({
      assigned: true,
      foundOnDeparture: true,
      attendance: "present",
      passengerName: "Անի",
    });
    assert.equal(plan.action, "repeat");
  });

  it("rejects a ticket from another departure and a guide who is no longer assigned", () => {
    assert.equal(
      planPassengerCheckIn({
        assigned: true,
        foundOnDeparture: false,
        attendance: null,
        passengerName: "",
      }).action,
      "reject",
    );
    assert.equal(
      planPassengerCheckIn({
        assigned: false,
        foundOnDeparture: true,
        attendance: null,
        passengerName: "Անի",
      }).action,
      "reject",
    );
  });
});
