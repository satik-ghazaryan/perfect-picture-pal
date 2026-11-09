import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { answerTourQuestion, publicFactsFromRows, replyKeepsPublishedFacts, type ChatFacts } from "./tour-chat-facts.ts";
import { rateLimitTourChat, replyToTourQuestion, resetTourChatRateLimit, anonCatalogKey } from "./tour-chat.server.ts";

const now = new Date("2026-11-09T10:00:00.000Z");

function facts(): ChatFacts {
  return publicFactsFromRows(
    [
      { id: "garni", title_hy: "Գառնի և Գեղարդ", price: 0, departure_time: "08:30", is_virtual_only: false },
      { id: "sevan", title_hy: "Սևան", price: 15000, departure_time: "08:00", is_virtual_only: false },
      { id: "tatev", title_hy: "Տաթև", price: null, departure_time: "", is_virtual_only: false },
    ],
    [
      { tour_id: "garni", departure_date: "2026-11-09", available_seats: 4 },
      { tour_id: "garni", departure_date: "2026-11-30", available_seats: 3 },
      { tour_id: "garni", departure_date: "2026-12-06", available_seats: 0 },
      { tour_id: "sevan", departure_date: "2026-11-15", available_seats: 2 },
    ],
  );
}

describe("public tour chat facts", () => {
  it("answers the Garni price, next open departure, and free seats from the supplied rows", () => {
    const reply = answerTourQuestion({
      message: "Որքա՞ն է Գառնիի գինը, հաջորդ մեկնումը և ազատ տեղերը",
      facts: facts(),
      now,
    });
    assert.match(reply, /Գինը դեռ նշված չէ/);
    assert.doesNotMatch(reply, /0 ֏|անվճար/);
    assert.match(reply, /30 նոյեմբեր 2026/);
    assert.match(reply, /08:30/);
    assert.match(reply, /Ազատ տեղերը՝ 3/);
    assert.match(reply, /\/tours\/garni/);
    assert.doesNotMatch(reply, /15000|4 տեղ|2026-11-09/);
  });

  it("says when a price or departure is missing and does not invent a number", () => {
    const reply = answerTourQuestion({
      message: "Տաթևի գինը, հաջորդ մեկնումը և ազատ տեղերը",
      facts: facts(),
      now,
    });
    assert.match(reply, /Գինը դեռ նշված չէ/);
    assert.match(reply, /առաջիկա բաց մեկնում այս պահին չկա/);
    assert.match(reply, /\/tours\/tatev/);
    assert.doesNotMatch(reply, /\d/);
  });

  it("says the catalog did not load instead of using a fallback price", () => {
    const reply = answerTourQuestion({
      message: "Գառնիի գինը",
      facts: { ok: false, tours: [] },
      now,
    });
    assert.match(reply, /չբեռնվեցին/);
    assert.doesNotMatch(reply, /\d|ֆ/);
  });

  it("asks which tour when the question is ambiguous and uses the open tour page when it is not", () => {
    const ambiguous = answerTourQuestion({ message: "ինչ արժե հաջորդ մեկնումը", facts: facts(), now });
    assert.match(ambiguous, /Ո՞ր տուրի/);
    assert.doesNotMatch(ambiguous, /\d|\/tours\//);

    const onPage = answerTourQuestion({
      message: "ինչ արժե և քանի ազատ տեղ կա",
      pageTourId: "garni",
      facts: facts(),
      now,
    });
    assert.match(onPage, /Գինը դեռ նշված չէ/);
    assert.match(onPage, /\/tours\/garni/);
    assert.doesNotMatch(onPage, /15000/);
  });

  it("keeps a named tour ahead of the page and only points to the booking form", () => {
    const reply = answerTourQuestion({
      message: "ուզում եմ ամրագրել Սևանը",
      pageTourId: "garni",
      facts: facts(),
      now,
    });
    assert.match(reply, /Ամրագրում չեմ կատարում/);
    assert.match(reply, /\/tours\/sevan/);
    assert.doesNotMatch(reply, /book_departure|0 ֏|անվճար/);
  });

  it("rejects a model reply that adds a price or drops the tour link", () => {
    const grounded = "Գառնի տուրի գինը այս պահին 12000 ֏ է։ Էջը՝ /tours/garni։";
    assert.equal(replyKeepsPublishedFacts(grounded, "Գինը 12000 ֏ է։ Էջը՝ /tours/garni։"), true);
    assert.equal(replyKeepsPublishedFacts(grounded, "Գինը 0 ֏ է։ Էջը՝ /tours/garni։"), false);
    assert.equal(replyKeepsPublishedFacts(grounded, "Գինը 12000 ֏ է։"), false);
  });
});

describe("public tour chat limit", () => {
  it("stops the ninth public request in the same minute and still answers from facts when the model key is absent", async () => {
    resetTourChatRateLimit();
    for (let index = 0; index < 8; index += 1) assert.equal(rateLimitTourChat("203.0.113.5", 1_000 + index), true);
    assert.equal(rateLimitTourChat("203.0.113.5", 1_007), false);
    assert.equal(rateLimitTourChat("203.0.113.6", 1_007), true);
    const reply = await replyToTourQuestion({
      message: "Գառնիի գինը",
      facts: facts(),
      now,
    });
    assert.match(reply, /Գինը դեռ նշված չէ/);
    assert.doesNotMatch(reply, /0 ֏|անվճար/);
    assert.match(reply, /\/tours\/garni/);
  });

  it("reads an open departure from isolated rows and the next request sees the new seat count", () => {
    const rows = (seats: number) =>
      publicFactsFromRows(
        [{ id: "garni", title_hy: "Գառնի", price: 12000, departure_time: "08:30", is_virtual_only: false }],
        [{ tour_id: "garni", departure_date: "2026-11-30", available_seats: seats }],
      );
    const first = answerTourQuestion({
      message: "Գառնիի գինը, հաջորդ մեկնումը և ազատ տեղերը",
      facts: rows(4),
      now,
    });
    const second = answerTourQuestion({
      message: "Գառնիի գինը, հաջորդ մեկնումը և ազատ տեղերը",
      facts: rows(1),
      now,
    });
    assert.match(first, /12000 ֏/);
    assert.match(first, /Ազատ տեղերը՝ 4/);
    assert.match(second, /Ազատ տեղերը՝ 1/);
    assert.doesNotMatch(second, /Ազատ տեղերը՝ 4/);
  });

  it("refuses a service role key and accepts only the public anon role", () => {
    const token = (role: string) => {
      const body = Buffer.from(JSON.stringify({ role })).toString("base64url");
      return `header.${body}.sig`;
    };
    assert.equal(anonCatalogKey(token("anon")), true);
    assert.equal(anonCatalogKey(token("service_role")), false);
    assert.equal(anonCatalogKey("not-a-jwt"), false);
  });
});
