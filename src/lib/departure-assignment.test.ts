import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assigneeRoleError,
  isExplicitDepartureDate,
  planLegacyDepartureLinks,
} from "./departure-assignment";

const guide = { id: "guide-1", role: "guide" };
const driver = { id: "driver-1", role: "driver" };

describe("departure assignment", () => {
  it("requires an explicit calendar date", () => {
    assert.equal(isExplicitDepartureDate("2026-11-14"), true);
    assert.equal(isExplicitDepartureDate("2026-02-31"), false);
    assert.equal(isExplicitDepartureDate(""), false);
  });

  it("does not invent a date for tour-level staff", () => {
    const plan = planLegacyDepartureLinks(
      [{ id: "1-ui", departureDate: null, guideId: "guide-1", driverId: null }],
      [],
      [guide],
    );
    assert.equal(plan.apply.length, 0);
    assert.equal(plan.conflicts.length, 1);
    assert.equal(plan.conflicts[0]?.tourId, "1-ui");
  });

  it("links one dated tour to a matching empty departure", () => {
    const plan = planLegacyDepartureLinks(
      [{ id: "1-ui", departureDate: "2026-11-14", guideId: "guide-1", driverId: "driver-1" }],
      [{ id: "dep-1", tourId: "1-ui", departureDate: "2026-11-14", guideId: null, driverId: null }],
      [guide, driver],
    );
    assert.equal(plan.conflicts.length, 0);
    assert.equal(plan.apply[0]?.departureId, "dep-1");
    assert.equal(plan.apply[0]?.guideId, "guide-1");
    assert.equal(plan.apply[0]?.driverId, "driver-1");
  });

  it("keeps a conflicting assignee unchanged", () => {
    const plan = planLegacyDepartureLinks(
      [{ id: "1-ui", departureDate: "2026-11-14", guideId: "guide-1", driverId: null }],
      [
        {
          id: "dep-1",
          tourId: "1-ui",
          departureDate: "2026-11-14",
          guideId: "guide-2",
          driverId: null,
        },
      ],
      [guide, { id: "guide-2", role: "guide" }],
    );
    assert.equal(plan.apply.length, 0);
    assert.equal(plan.conflicts.length, 1);
  });

  it("rejects an account whose role does not match the seat", () => {
    assert.equal(assigneeRoleError("guide", "driver"), "Ընտրված հաշիվը զբոսավար չէ։");
    assert.equal(assigneeRoleError("driver", "driver"), null);
  });
});
