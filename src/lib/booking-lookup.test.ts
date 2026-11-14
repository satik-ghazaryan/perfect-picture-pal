import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  departureInstant,
  findGuestBooking,
  normalizeTicketCode,
  phoneTail,
  type LookupBookingRow,
} from "./booking-lookup";

const row: LookupBookingRow = {
  ticketCode: "AG-7933D3BB",
  passengerName: "Անի Սարգսյան",
  phone: "+374 94 111000",
  tourId: "dilijan-autumn",
  departureId: "dep-1",
  seatNumber: 1,
  adults: 2,
  children: 0,
  status: "booked",
  paymentStatus: "SUCCESS",
  amount: 16000,
};

function deps(rows: LookupBookingRow[]) {
  const asked: string[] = [];
  return {
    asked,
    deps: {
      loadBookings: async () => rows,
      loadDeparture: async () => ({
        departureDate: "2026-11-29",
        guideId: "guide-1",
        driverId: null,
      }),
      loadTour: async () => ({
        title: "Աշնանային Դիլիջան՝ Արմավիրից",
        departureTime: "08:00",
        departurePlace: "Արմավիր քաղաք",
      }),
      loadStaff: async (id: string, role: "guide" | "driver") => {
        asked.push(`${role}:${id}`);
        return { fullName: "Սերգե Ավետիսյան", avatarUrl: "" };
      },
    },
  };
}

const leaves = Date.parse("2026-11-29T08:00:00+04:00");

describe("guest booking lookup", () => {
  it("reads codes and phones the way people type them", () => {
    assert.equal(normalizeTicketCode("  ag-7933d3bb "), "AG-7933D3BB");
    assert.equal(normalizeTicketCode("7933D3BB"), "");
    assert.equal(phoneTail("+374 94 111000"), "94111000");
    assert.equal(phoneTail("094111000"), "94111000");
    assert.equal(phoneTail("12345"), "");
    assert.equal(departureInstant("2026-11-29", "08:00"), leaves);
  });

  it("shows the booking but keeps the crew hidden until one day before departure", async () => {
    const { asked, deps: d } = deps([row, { ...row, seatNumber: 2, amount: 0 }]);
    const result = await findGuestBooking(
      { ticketCode: "ag-7933d3bb", phone: "094111000" },
      d,
      leaves - 3 * 24 * 60 * 60 * 1000,
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.booking.tourTitle, "Աշնանային Դիլիջան՝ Արմավիրից");
    assert.deepEqual(result.booking.seatNumbers, [1, 2]);
    assert.equal(result.booking.amount, 16000);
    assert.equal(result.booking.paid, true);
    assert.equal(result.booking.crewRevealed, false);
    assert.equal(result.booking.guide, null);
    assert.deepEqual(asked, []);
  });

  it("names the assigned guide once the departure is a day away", async () => {
    const { asked, deps: d } = deps([row]);
    const result = await findGuestBooking(
      { ticketCode: "AG-7933D3BB", phone: "+37494111000" },
      d,
      leaves - 20 * 60 * 60 * 1000,
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.booking.crewRevealed, true);
    assert.equal(result.booking.guide?.fullName, "Սերգե Ավետիսյան");
    assert.equal(result.booking.driver, null);
    assert.deepEqual(asked, ["guide:guide-1"]);
  });

  it("gives the same answer for an unknown code and a wrong phone", async () => {
    const wrongPhone = await findGuestBooking(
      { ticketCode: "AG-7933D3BB", phone: "+37499000000" },
      deps([row]).deps,
    );
    const unknownCode = await findGuestBooking(
      { ticketCode: "AG-00000000", phone: "+37494111000" },
      deps([]).deps,
    );
    assert.equal(wrongPhone.ok, false);
    assert.equal(unknownCode.ok, false);
    if (!wrongPhone.ok && !unknownCode.ok) {
      assert.equal(wrongPhone.code, "not_found");
      assert.equal(wrongPhone.message, unknownCode.message);
    }
  });

  it("does not reveal the crew for a cancelled booking", async () => {
    const result = await findGuestBooking(
      { ticketCode: "AG-7933D3BB", phone: "+37494111000" },
      deps([{ ...row, status: "cancelled" }]).deps,
      leaves - 60 * 60 * 1000,
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.booking.status, "cancelled");
      assert.equal(result.booking.crewRevealed, false);
      assert.equal(result.booking.guide, null);
    }
  });
});
