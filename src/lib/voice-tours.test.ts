import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChatFacts } from "./tour-chat-facts.ts";
import { voiceToursPayload } from "./voice-tours.ts";

const facts: ChatFacts = {
  ok: true,
  cashbackPercent: 5,
  tours: [
    {
      id: "tatev",
      title: "Արմավիր – Տաթևի վանք",
      price: 11500,
      departureTime: "06:30",
      departurePlace: "Արմավիր քաղաք",
      highlights: [],
      included: ["Տրանսպորտ", "Զբոսավար"],
      excluded: [],
      isVirtual: false,
      location: null,
      departures: [
        { id: "d-past-0001", date: "2026-11-14", seats: 5 },
        { id: "d-next-0002", date: "2026-11-28", seats: 17 },
        { id: "d-full-0003", date: "2026-11-21", seats: 0 },
      ],
    },
    {
      id: "garni",
      title: "Գառնի",
      price: 0,
      departureTime: "08:30",
      departurePlace: null,
      highlights: [],
      included: [],
      excluded: [],
      isVirtual: false,
      location: null,
      departures: [],
    },
  ],
};

describe("voice tours payload", () => {
  const now = new Date("2026-11-20T10:00:00Z");
  const payload = voiceToursPayload(facts, now);

  it("keeps only open departures, sorted, with weekday and seats", () => {
    assert.equal(payload.today, "2026-11-20");
    assert.deepEqual(payload.tours[0]?.upcoming, [
      { date: "2026-11-21", weekday: "շաբաթ", seatsLeft: 0 },
      { date: "2026-11-28", weekday: "շաբաթ", seatsLeft: 17 },
    ]);
  });

  it("names the marz so a caller asking for a region finds the tour", () => {
    assert.deepEqual(payload.tours[0]?.regions, ["Սյունիք"]);
    assert.match(payload.summary, /Արմավիր – Տաթևի վանք \(Սյունիք մարզ\): 11500 դրամ/);
  });

  it("hides a zero price and says when no departures are scheduled", () => {
    assert.equal(payload.tours[1]?.priceAmd, null);
    assert.match(payload.summary, /Գառնի \(Կոտայք մարզ\): գինը ճշտել մենեջերից/);
    assert.match(payload.summary, /առաջիկա մեկնումներ դեռ նշանակված չեն/);
    assert.match(payload.summary, /2026-11-21 \(շաբաթ\) — տեղեր չկան/);
  });

  it("reports unavailability without inventing tours", () => {
    const down = voiceToursPayload({ ok: false, tours: [] }, now);
    assert.equal(down.ok, false);
    assert.deepEqual(down.tours, []);
  });
});
