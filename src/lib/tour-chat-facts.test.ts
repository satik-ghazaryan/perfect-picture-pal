import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { answerTourQuestion, answerTourChat, groundChatAnswer, openChatSection, publicFactsFromRows, replyKeepsPublishedFacts, validatedChatReading, type ChatFacts } from "./tour-chat-facts.ts";
import { CHAT_TEST_OPEN_DATE, CHAT_TEST_TITLE, CHAT_TEST_TOUR_ID } from "./chat-test-fixture.ts";
import { confirmPreviewFixture, findPreviewTicket, isolatedBookingChecks } from "./tour-chat-booking.ts";
import { interestConfirmation, interestOfferEnabled, interestPreviewScenario, sameInterest } from "./tour-interest.ts";
import { rateLimitTourChat, replyToTourQuestion, resetTourChatRateLimit, anonCatalogKey, telegramRateKey } from "./tour-chat.server.ts";

const now = new Date("2026-11-09T10:00:00.000Z");

function facts(): ChatFacts {
  return publicFactsFromRows(
    [
      { id: "garni", title_hy: "Գառնի և Գեղարդ", price: 0, departure_time: "08:30", is_virtual_only: false },
      { id: "sevan", title_hy: "Սևան", price: 15000, departure_time: "08:00", is_virtual_only: false },
      { id: "tatev", title_hy: "Տաթև", price: null, departure_time: "", is_virtual_only: false },
    ],
    [
      { id: "garni-dep-1109", tour_id: "garni", departure_date: "2026-11-09", available_seats: 4 },
      { id: "garni-dep-1130", tour_id: "garni", departure_date: "2026-11-30", available_seats: 3 },
      { id: "garni-dep-1206", tour_id: "garni", departure_date: "2026-12-06", available_seats: 0 },
      { id: "sevan-dep-1115", tour_id: "sevan", departure_date: "2026-11-15", available_seats: 2 },
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
    assert.match(reply, /դեռ հրապարակված չէ/);
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
    assert.match(reply, /դեռ հրապարակված չէ/);
    assert.match(reply, /առաջիկա բաց մեկնում դեռ չկա/);
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
    assert.match(onPage, /դեռ հրապարակված չէ/);
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
    assert.match(reply, /15 նոյեմբեր 2026/);
    assert.match(reply, /\[Բացել տուրի էջը\]\(\/tours\/sevan\)/);
    assert.doesNotMatch(reply, /Ամրագրում չեմ կատարում|book_departure|0 ֏|անվճար/);
  });

  it("rejects a model reply that adds a price or drops the tour link", () => {
    const grounded = "Գառնի տուրի գինը այս պահին 12000 ֏ է։ Էջը՝ /tours/garni։";
    assert.equal(replyKeepsPublishedFacts(grounded, "Գինը 12000 ֏ է։ Էջը՝ /tours/garni։"), true);
    assert.equal(replyKeepsPublishedFacts(grounded, "Գինը 0 ֏ է։ Էջը՝ /tours/garni։"), false);
    assert.equal(replyKeepsPublishedFacts(grounded, "Գինը 12000 ֏ է։"), false);
  });

  it("summarizes a bare tour name and lets ասա continue that tour", () => {
    const first = answerTourQuestion({ message: "գառնի", facts: facts(), now });
    const second = answerTourQuestion({
      message: "ասա",
      facts: facts(),
      now,
      history: [
        { role: "user", text: "գառնի" },
        { role: "assistant", text: first },
      ],
    });
    for (const reply of [first, second]) {
      assert.match(reply, /Գառնի և Գեղարդ/);
      assert.match(reply, /դեռ հրապարակված չէ/);
      assert.match(reply, /30 նոյեմբեր 2026/);
      assert.match(reply, /Ազատ տեղերը՝ 3/);
      assert.match(reply, /\[Բացել տուրի էջը\]\(\/tours\/garni\)/);
      assert.doesNotMatch(reply, /կարող եմ ասել|Ամրագրում չեմ կատարում/);
    }
  });

  it("keeps Garni for follow-up price and seats, then switches to Sevan", () => {
    const history = [{ role: "user" as const, text: "Գառնի" }];
    const price = answerTourQuestion({ message: "իսկ գինը", facts: facts(), now, history });
    const seats = answerTourQuestion({
      message: "քանի տեղ կա",
      facts: facts(),
      now,
      history: [...history, { role: "assistant", text: price }, { role: "user", text: "իսկ գինը" }],
    });
    const sevan = answerTourQuestion({ message: "իսկ Սևանը", facts: facts(), now, history });
    assert.match(price, /դեռ հրապարակված չէ/);
    assert.match(price, /\/tours\/garni/);
    assert.doesNotMatch(price, /15000|Ազատ տեղերը/);
    assert.match(seats, /Ազատ տեղերը՝ 3/);
    assert.match(seats, /\/tours\/garni/);
    assert.match(sevan, /15000 դրամ/);
    assert.match(sevan, /\/tours\/sevan/);
    assert.doesNotMatch(sevan, /դեռ հրապարակված չէ/);
  });

  it("offers Gyumri interest from the Tatev page instead of the open tour", () => {
    const answer = answerTourChat({ message: "Գյումրի", pageTourId: "tatev", facts: facts(), now });
    assert.equal(answer.interest?.tourId, null);
    assert.equal(answer.interest?.label, "Գյումրի");
    assert.match(answer.reply, /Գյումրիի ուղղությամբ այս պահին տուր չունենք/);
    assert.doesNotMatch(answer.reply, /Տաթև/);
    const page = answerTourChat({ message: "գինը", pageTourId: "tatev", facts: facts(), now });
    assert.match(page.reply, /\/tours\/tatev/);
    assert.equal(page.interest?.label.includes("Գյումրի"), false);
  });

  it("answers Lori, then included fees, seats, and switches to Dilijan choices", () => {
    const catalog = publicFactsFromRows(
      [
        {
          id: "lori",
          title_hy: "Լոռի՝ Արմավիրից",
          price: 9000,
          departure_time: "08:00",
          highlights: ["Ախթալա", "Սանահին", "Հաղպատ"],
          included: ["Հարմարավետ տրանսպորտ"],
          excluded: ["Մենձ Էր քարանձավի մուտք՝ 1 000 դրամ"],
          is_virtual_only: false,
        },
        { id: "dilijan-autumn", title_hy: "Աշնանային Դիլիջան՝ Արմավիրից", price: 8000, departure_time: "08:00", is_virtual_only: false },
        { id: "sevan", title_hy: "Արմավիր – Սևանա լիճ, Դիլիջան և Հաղարծին", price: 15000, departure_time: "08:00", is_virtual_only: false },
      ],
      [],
    );
    const lori = answerTourChat({ message: "Լոռի", facts: catalog, now, pageTourId: "garni" });
    assert.equal(lori.reply, "Լոռի առաջիկա բաց մեկնում դեռ չկա։ Ցանկանո՞ւմ ես գրանցել հետաքրքրությունդ");
    assert.equal(lori.interest?.tourId, "lori");
    assert.equal(lori.booking, null);
    const history = [{ role: "user" as const, text: "Լոռի" }];
    const included = answerTourChat({ message: "ի՞նչ է ներառված", facts: catalog, now, history, pageTourId: "garni" });
    assert.match(included.reply, /^«Լոռի՝ Արմավիրից» տուրում ներառված է/);
    assert.match(included.reply, /Առանձին է վճարվում՝ Մենձ Էր քարանձավի մուտք՝ 1 000 դրամ/);
    const seats = answerTourChat({ message: "իսկ տեղ կա՞", facts: catalog, now, history });
    assert.match(seats.reply, /առաջիկա բաց մեկնում դեռ չկա/);
    assert.equal(seats.booking, null);
    const dilijan = answerTourChat({ message: "իսկ Դիլիջանը՞", facts: catalog, now, history, pageTourId: "lori" });
    assert.equal(dilijan.booking, null);
    assert.deepEqual(dilijan.choices?.map((item) => item.id).sort(), ["dilijan-autumn", "sevan"]);
    assert.deepEqual(
      dilijan.choices?.map((item) => item.title).sort(),
      ["Աշնանային Դիլիջան", "Սևան, Դիլիջան և Հաղարծին"].sort(),
    );
    const autumn = answerTourChat({ message: "ԱՇՆԱՆԱՅԻՆ դիլիջան", facts: catalog, now, pageTourId: "lori" });
    assert.equal(autumn.choices, null);
    assert.match(autumn.reply, /Աշնանային Դիլիջան առաջիկա բաց մեկնում դեռ չկա/);
    assert.doesNotMatch(autumn.reply, /Սևանա լիճ/);
  });

  it("greets first, answers the price on the first line, and keeps the phone for a contact question", () => {
    const greeting = answerTourChat({ message: "Բարև", facts: facts(), now });
    assert.equal(greeting.reply, "Բարև՜ 👋 Որևէ ուղղություն մտքո՞ւմ ունես, թե՞ նայենք՝ ինչ տուրեր ունենք առաջիկայում");
    assert.equal(greeting.interest, null);
    const price = answerTourChat({
      message: "իսկ գինը՞",
      facts: facts(),
      now,
      history: [{ role: "user", text: "Գառնի" }],
    });
    assert.match(price.reply, /^Գառնիի տուրի գինը դեռ հրապարակված չէ։\n/);
    const catalog = publicFactsFromRows(
      [{
        id: "lori",
        title_hy: "Լոռի՝ Արմավիրից",
        price: 9000,
        departure_time: "08:00",
        highlights: ["Ախթալա", "Կապ՝ 094 15 80 20"],
        included: ["Հարմարավետ տրանսպորտ"],
        is_virtual_only: false,
      }],
      [],
    );
    const summary = answerTourChat({ message: "Լոռի", facts: catalog, now });
    assert.doesNotMatch(summary.reply, /094/);
    assert.equal(summary.reply, "Լոռի առաջիկա բաց մեկնում դեռ չկա։ Ցանկանո՞ւմ ես գրանցել հետաքրքրությունդ");
    const contact = answerTourChat({ message: "հեռախոսը", facts: catalog, now, history: [{ role: "user", text: "Լոռի" }] });
    assert.match(contact.reply, /^Կապվել կարող ես այս համարով՝ 094 15 80 20/);
  });

  it("keeps Gyumri apart from Lori and shows the food-court stop only in the full program", () => {
    const catalog = publicFactsFromRows(
      [{
        id: "lori",
        title_hy: "Լոռի՝ Արմավիրից",
        price: 9000,
        departure_time: "08:00",
        highlights: ["Ախթալա", "Ֆուդ կորտ"],
        included: ["Հարմարավետ տրանսպորտ"],
        excluded: ["Սնունդ"],
        is_virtual_only: false,
      }],
      [],
    );
    const amberd = answerTourChat({ message: "Ամբերդ", facts: catalog, now });
    assert.match(amberd.reply, /Ամբերդի ուղղությամբ այս պահին տուր չունենք/);
    const gyumri = answerTourChat({ message: "իսկ Գյումրի՞", facts: catalog, now });
    assert.match(gyumri.reply, /^Գյումրիի ուղղությամբ այս պահին տուր չունենք/);
    assert.doesNotMatch(gyumri.reply, /գրանցվել հնարավոր չէ/);
    const lori = answerTourChat({ message: "Լոռի", facts: catalog, now });
    assert.doesNotMatch(lori.reply, /Ֆուդ կորտ/);
    assert.match(lori.reply, /^Լոռի առաջիկա բաց մեկնում դեռ չկա/);
    const notice = answerTourChat({
      message: "որ Գյումրի տոր լինի ինձ կասեք՞",
      facts: catalog,
      now,
      history: [{ role: "user", text: "Լոռի" }],
      channel: "off",
    });
    assert.match(notice.reply, /Գյումրիի ուղղությամբ այս պահին տուր չունենք/);
    assert.match(notice.reply, /Ցանկանո՞ւմ ես գրանցել հետաքրքրությունդ/);
    assert.equal(notice.interest?.label, "Գյումրի");
    const history = [
      { role: "user" as const, text: "Գյումրի" },
      { role: "user" as const, text: "Լոռի" },
      { role: "user" as const, text: "որ Գյումրի տոր լինի ինձ կասեք՞" },
    ];
    const full = answerTourChat({ message: "ամբողջ ինֆորմացիան", facts: catalog, now, history });
    assert.match(full.reply, /Գյումրիի՞ մասին ես հարցնում, թե՞ Լոռու տուրի ամբողջ ծրագիրն ես ուզում տեսնել/);
    assert.deepEqual(full.choices?.map((item) => item.title), ["Գյումրի", "Լոռու տուրի ամբողջ ծրագիրը"]);
    const program = answerTourChat({ message: "Լոռու տուրի ամբողջ ծրագիրը", facts: catalog, now, history });
    assert.match(program.reply, /Երթուղին՝ Ախթալա/);
    assert.match(program.reply, /Ֆուդ կորտը սնվելու և հանգստանալու կանգառ է/);
    assert.match(program.reply, /9000 դրամ/);
    assert.match(program.reply, /Հարմարավետ տրանսպորտ/);
    assert.match(program.reply, /Առանձին է վճարվում՝ Սնունդ/);
    const remembered = validatedChatReading(
      { intent: "notice", direction: null, party: null },
      "որ լինի կհիշեք ինձ՞",
      { direction: "Գյումրի", tour: null },
      catalog.tours,
    );
    assert.equal(remembered?.intent, "notice");
    assert.equal(remembered?.direction, "Գյումրի");
    const noticeReading = answerTourChat({
      message: "որ լինի կհիշեք ինձ՞",
      facts: catalog,
      now,
      history: [{ role: "user", text: "Գյումրի" }],
      reading: remembered,
    });
    assert.match(noticeReading.reply, /Գյումրիի ուղղությամբ այս պահին տուր չունենք/);
    assert.equal(noticeReading.booking, null);
    assert.equal(noticeReading.interest?.label, "Գյումրի");
    const pair = validatedChatReading(
      { intent: "price", direction: "Լոռի", party: 2 },
      "Լոռին ինչքա՞ն կնստի երկուսիս համար",
      { direction: "Գյումրի", tour: null },
      catalog.tours,
    );
    const pairReply = answerTourChat({
      message: "Լոռին ինչքա՞ն կնստի երկուսիս համար",
      facts: catalog,
      now,
      reading: pair,
    });
    assert.match(pairReply.reply, /^Երկու հոգու համար՝ 18000 դրամ/);
    assert.match(pairReply.reply, /9000 դրամ/);
    assert.equal(pairReply.booking, null);
    const invented = validatedChatReading(
      { intent: "price", direction: "Փարիզ", party: 9 },
      "ինչքան արժե",
      { direction: null, tour: null },
      catalog.tours,
    );
    assert.equal(invented?.direction, null);
    assert.equal(invented?.party, null);
    const switched = answerTourChat({
      message: "Ամրագր2 տեղ ամբերդ տուրին",
      facts: facts(),
      now,
      history: [{ role: "user", text: "Տաթև" }],
    });
    assert.equal(switched.booking, null);
    assert.equal(switched.interest?.label, "Ամբերդ");
    assert.match(switched.reply, /Ամբերդի ուղղությամբ այս պահին տուր չունենք/);
    assert.doesNotMatch(switched.reply, /Տաթև/);
    const rememberedAmberd = answerTourChat({
      message: "Որ լինի՝ կհիշե՞ք ինձ",
      facts: facts(),
      now,
      history: [{ role: "user", text: "Ամբերդ" }],
    });
    assert.equal(rememberedAmberd.interest?.label, "Ամբերդ");
    assert.match(rememberedAmberd.reply, /Ամբերդի ուղղությամբ այս պահին տուր չունենք/);
    const rulesNotice = answerTourChat({
      message: "որ լինի կհիշեք ինձ՞",
      facts: catalog,
      now,
      history: [{ role: "user", text: "Գյումրի" }],
    });
    assert.match(rulesNotice.reply, /Գյումրիի ուղղությամբ այս պահին տուր չունենք/);
    const rulesPrice = answerTourChat({
      message: "Լոռին ինչքա՞ն կնստի երկուսիս համար",
      facts: catalog,
      now,
    });
    assert.match(rulesPrice.reply, /^Երկու հոգու համար՝ 18000 դրամ/);
    assert.equal(rulesPrice.booking, null);
    const both = answerTourChat({ message: "ե՞րբ է ու ինչքա՞ն արժե", facts: catalog, now, history: [{ role: "user", text: "Լոռի" }] });
    assert.match(both.reply, /առաջիկա բաց մեկնում դեռ չկա/);
    assert.match(both.reply, /9000 դրամ/);
    const gyumriPrice = answerTourChat({
      message: "Գյումրի տուրը սովորաբար ինչ արժի",
      facts: catalog,
      now,
      history: [{ role: "user", text: "Լոռի" }],
    });
    assert.match(gyumriPrice.reply, /^Գյումրիի տուրի գինը դեռ հրապարակված չէ/);
    assert.doesNotMatch(gyumriPrice.reply, /Գինը, ժամը|Լոռի/);
    const pairAfter = answerTourChat({
      message: "Լոռին 2 հոգու համար ինչ արժի՞",
      facts: catalog,
      now,
      history: [{ role: "user", text: "Գյումրի" }],
      registered: [{ tourId: "lori", key: "լոռի" }],
    });
    assert.match(pairAfter.reply, /^Երկու հոգու համար՝ 18000 դրամ \(9000 դրամ՝ մեկ անձի համար\)/);
    assert.match(pairAfter.reply, /Լոռի առաջիկա բաց մեկնում դեռ չկա/);
    assert.equal(pairAfter.interest, null);
    const time = answerTourChat({
      message: "Իսկ ժամը՞",
      facts: catalog,
      now,
      history: [{ role: "user", text: "Լոռին 2 հոգու համար ինչ արժի" }],
      registered: [{ tourId: "lori", key: "լոռի" }],
    });
    assert.match(time.reply, /^Լոռի առաջիկա բաց մեկնում դեռ չկա/);
    assert.equal(time.interest, null);
    const again = answerTourChat({
      message: "կարո՞ղ եք ինձ նախապես տեղեկացնել",
      facts: catalog,
      now,
      history: [{ role: "user", text: "Լոռի" }],
      registered: [{ tourId: "lori", key: "լոռի" }],
    });
    assert.equal(again.reply, "Լոռու տուրի նկատմամբ հետաքրքրությունդ արդեն գրանցված է");
    assert.equal(again.interest, null);
    const soldOut = answerTourChat({
      message: "Առաջիկա տուրեր",
      facts: publicFactsFromRows(
        [{ id: "garni", title_hy: "Արմավիր – Գառնի, Գեղարդ և Քարերի Սիմֆոնիա", price: 12000, departure_time: "08:30", is_virtual_only: false }],
        [{ id: "garni-full", tour_id: "garni", departure_date: "2026-11-30", available_seats: 0 }],
      ),
      now,
    });
    assert.equal(soldOut.reply, "Նոյեմբերի 30-ի «Արմավիր – Գառնի, Գեղարդ և Քարերի Սիմֆոնիա» տուրի բոլոր տեղերը զբաղված են։");
    assert.equal(soldOut.choices, null);
    const shown = "Նոյեմբերի 30-ի «Արմավիր – Գառնի, Գեղարդ և Քարերի Սիմֆոնիա» տուրի բոլոր տեղերը զբաղված են։";
    const priced = publicFactsFromRows(
      [{ id: "garni", title_hy: "Արմավիր – Գառնի, Գեղարդ և Քարերի Սիմֆոնիա", price: 12000, departure_time: "08:30", is_virtual_only: false }],
      [{ id: "garni-full", tour_id: "garni", departure_date: "2026-11-30", available_seats: 0 }],
    );
    const howMuch = answerTourChat({
      message: "իսկ արժեքը որքան է՞",
      facts: priced,
      now,
      history: [
        { role: "user", text: "Առաջիկա տուրեր" },
        { role: "assistant", text: shown },
      ],
    });
    assert.match(howMuch.reply, /^Գառնի–Գեղարդ տուրի հրապարակված գինը մեկ անձի համար 12000 դրամ է/);
    assert.match(howMuch.reply, /Նոյեմբերի 30-ի/);
    const bothTours = publicFactsFromRows(
      [
        { id: "garni", title_hy: "Արմավիր – Գառնի, Գեղարդ և Քարերի Սիմֆոնիա", price: 12000, departure_time: "08:30", is_virtual_only: false },
        { id: "lori", title_hy: "Լոռի՝ Արմավիրից", price: 9000, departure_time: "08:00", is_virtual_only: false },
      ],
      [{ id: "garni-full", tour_id: "garni", departure_date: "2026-11-30", available_seats: 0 }],
    );
    const several = answerTourChat({
      message: "իսկ արժեքը որքան է՞",
      facts: bothTours,
      now,
      shownTourIds: ["garni", "lori"],
      history: [{ role: "assistant", text: "Ընտրիր ուղղությունը։" }],
    });
    assert.equal(several.reply, "Ո՞ր տուրի գինն ես ուզում իմանալ");
    const chosen = answerTourChat({
      message: "Գառնի",
      facts: priced,
      now,
      history: [{ role: "assistant", text: several.reply }],
    });
    assert.match(chosen.reply, /^Գառնի–Գեղարդ տուրի հրապարակված գինը մեկ անձի համար 12000 դրամ է/);
    const later = answerTourChat({
      message: "բայց եթե լինի ինչքան կլինի",
      facts: priced,
      now,
      history: [
        { role: "assistant", text: shown },
        { role: "assistant", text: "Հետաքրքրությունդ գրանցված է" },
      ],
      registered: [{ tourId: "garni", key: "գառնի" }],
    });
    assert.match(later.reply, /^Գառնի–Գեղարդ տուրի հրապարակված գինը մեկ անձի համար 12000 դրամ է։ Հաջորդ մեկնման գինը կհաստատվի, երբ այն հրապարակվի/);
    assert.equal(later.interest, null);
    const missing = answerTourChat({
      message: "բայց եթե լինի ինչքան կլինի",
      facts: publicFactsFromRows(
        [{ id: "garni", title_hy: "Արմավիր – Գառնի, Գեղարդ և Քարերի Սիմֆոնիա", price: 0, departure_time: "08:30", is_virtual_only: false }],
        [{ id: "garni-full", tour_id: "garni", departure_date: "2026-11-30", available_seats: 0 }],
      ),
      now,
      history: [{ role: "assistant", text: shown }],
    });
    assert.match(missing.reply, /^Գառնի–Գեղարդի հաջորդ մեկնման գինը դեռ հրապարակված չէ/);
  });

  it("answers two seats as information and opens booking only for an explicit request", () => {
    const info = answerTourChat({
      message: "2 տեղ կա՞",
      facts: facts(),
      now,
      history: [{ role: "user", text: "Գառնի" }],
    });
    assert.equal(info.booking, null);
    assert.match(info.reply, /^Այո, 2 տեղ կա/);
    const booking = answerTourChat({
      message: "ուզում եմ 2 տեղ ամրագրել",
      facts: facts(),
      now,
      history: [{ role: "user", text: "Գառնի" }],
    });
    assert.equal(booking.booking?.party, 2);
    assert.equal(booking.booking?.tourId, "garni");
    assert.equal(booking.booking?.departures.length, 1);
    const full = answerTourChat({
      message: "2 տեղ ամրագրի",
      facts: publicFactsFromRows(
        [{ id: "garni", title_hy: "Արմավիր – Գառնի, Գեղարդ և Քարերի Սիմֆոնիա", price: 12000, departure_time: "08:30", is_virtual_only: false }],
        [{ id: "garni-full", tour_id: "garni", departure_date: "2026-11-30", available_seats: 0 }],
      ),
      now,
      history: [{ role: "user", text: "Գառնի" }],
    });
    assert.equal(full.booking?.departures.length, 0);
    assert.match(full.reply, /^Նոյեմբերի 30-ի «Արմավիր – Գառնի, Գեղարդ և Քարերի Սիմֆոնիա» տուրի բոլոր տեղերը զբաղված են/);
  });

  it("answers price, departure place, and this week's published departures", () => {
    const history = [{ role: "user" as const, text: "Գառնի" }];
    const place = answerTourQuestion({
      message: "որտեղի՞ց ենք շարժվում",
      facts: publicFactsFromRows(
        [{ id: "garni", title_hy: "Գառնի", price: 12000, departure_place: "Կենտրոնական հրապարակ", departure_time: "08:30", is_virtual_only: false }],
        [{ id: "garni-dep", tour_id: "garni", departure_date: "2026-11-30", available_seats: 3 }],
      ),
      now,
      history,
    });
    assert.match(place, /^Շարժվում ենք այս վայրից՝ Կենտրոնական հրապարակ/);
    const both = answerTourQuestion({ message: "ե՞րբ է ու ինչքա՞ն արժե", facts: facts(), now, history });
    assert.match(both, /Հաջորդ բաց մեկնումը/);
    assert.match(both, /դեռ հրապարակված չէ/);
    const week = answerTourQuestion({ message: "Այս շաբաթ ի՞նչ ունեք", facts: facts(), now });
    assert.match(week, /Սևան/);
    assert.match(week, /15 նոյեմբեր 2026/);
    assert.doesNotMatch(week, /30 նոյեմբեր/);
    const sold = answerTourQuestion({
      message: "Այս շաբաթ ի՞նչ ունեք",
      facts: publicFactsFromRows(
        [{ id: "garni", title_hy: "Գառնի", price: 12000, departure_time: "08:30", is_virtual_only: false }],
        [{ id: "garni-week", tour_id: "garni", departure_date: "2026-11-14", available_seats: 0 }],
      ),
      now,
    });
    assert.match(sold, /Այս շաբաթ առաջիկա մեկնում կա, բայց տեղերը սպառվել են/);
    const empty = answerTourQuestion({
      message: "Այս շաբաթ ի՞նչ ունեք",
      facts: publicFactsFromRows(
        [{ id: "tatev", title_hy: "Տաթև", price: 10000, departure_time: "07:00", is_virtual_only: false }],
        [],
      ),
      now,
    });
    assert.match(empty, /Այս շաբաթ առաջիկա մեկնում չկա/);
    const unread = answerTourQuestion({
      message: "Այս շաբաթ ի՞նչ ունեք",
      facts: { ok: false, tours: [] },
      now,
    });
    assert.match(unread, /չբեռնվեցին/);
  });

  it("answers a free-seat question and does not open booking", () => {
    const answer = answerTourChat({
      message: "քանի ազատ տեղ կա",
      facts: facts(),
      now,
      history: [{ role: "user", text: "Գառնի" }],
    });
    assert.equal(answer.booking, null);
    assert.equal(answer.interest, null);
    assert.match(answer.reply, /Ազատ տեղերը՝ 3/);
    const booking = answerTourChat({ message: "ամրագրիր 2 տեղ", facts: facts(), now, history: [{ role: "user", text: "Գառնի" }] });
    assert.equal(booking.booking?.party, 2);
    assert.equal(booking.booking?.tourId, "garni");
    assert.match(booking.reply, /30 նոյեմբեր 2026/);
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
      skipModel: true,
    });
    assert.equal(reply.understood, "rules");
    assert.match(reply.reply, /բացել կատալոգը/);
    assert.equal(reply.choices?.some((item) => item.id === "garni"), true);
    assert.doesNotMatch(reply.reply, /0 ֏|անվճար|\d/);
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
    assert.match(first, /12000 դրամ/);
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

  it("books isolated data once, then rejects a changed price, a full departure, a started departure, and a second confirm", () => {
    const result = isolatedBookingChecks();
    assert.equal(result.cancelled.booked, false);
    assert.equal(result.success.ok && result.success.ticketCode, "AG-TEST1");
    assert.equal(result.repeat.ok && result.repeat.repeated, true);
    assert.equal(result.repeat.ok && result.repeat.ticketCode, "AG-TEST1");
    assert.equal(result.changedPrice.ok, false);
    if (!result.changedPrice.ok) {
      assert.equal(result.changedPrice.code, "stale");
      assert.equal(result.changedPrice.fresh?.total, 30000);
    }
    assert.equal(result.full.ok, false);
    if (!result.full.ok) assert.equal(result.full.code, "sold_out");
    assert.equal(result.started.ok, false);
    if (!result.started.ok) assert.match(result.started.message, /արդեն փակ է/);
    const now = new Date("2026-11-09T10:00:00.000Z");
    const open = confirmPreviewFixture({
      departureId: "chat-test-open",
      party: 2,
      key: "preview-key-open-1",
      proof: "preview-proof-open",
      expectedPrice: 12000,
      expectedSeats: 4,
      expectedDate: "2026-12-20",
      expectedCashback: 5,
      now,
    });
    const again = confirmPreviewFixture({
      departureId: "chat-test-open",
      party: 2,
      key: "preview-key-open-1",
      proof: "preview-proof-open",
      expectedPrice: 12000,
      expectedSeats: 4,
      expectedDate: "2026-12-20",
      expectedCashback: 5,
      now,
    });
    assert.equal(open.ok, true);
    assert.equal(again.ok && again.ticketCode, open.ok && open.ticketCode);
    const price = confirmPreviewFixture({
      departureId: "chat-test-price",
      party: 2,
      key: "preview-key-price-1",
      proof: "preview-proof-price",
      expectedPrice: 12000,
      expectedSeats: 4,
      expectedDate: "2026-12-20",
      expectedCashback: 5,
      now,
    });
    assert.equal(price.ok, false);
    if (!price.ok) assert.equal(price.code, "stale");
    const full = confirmPreviewFixture({
      departureId: "chat-test-full",
      party: 2,
      key: "preview-key-full-01",
      proof: "preview-proof-full1",
      expectedPrice: 12000,
      expectedSeats: 4,
      expectedDate: "2026-12-20",
      expectedCashback: 5,
      now,
    });
    assert.equal(full.ok, false);
    if (!full.ok) assert.equal(full.code, "sold_out");
    const closed = confirmPreviewFixture({
      departureId: "chat-test-closed",
      party: 2,
      key: "preview-key-closed1",
      proof: "preview-proof-close",
      expectedPrice: 12000,
      expectedSeats: 4,
      expectedDate: "2026-11-09",
      expectedCashback: 5,
      now,
    });
    assert.equal(closed.ok, false);
    if (!closed.ok) assert.equal(closed.code, "closed");
  });

  it("offers interest for a missing direction or a tour without an open departure, and sends one notice", () => {
    const lori = answerTourChat({ message: "Լոռի կա", facts: facts(), now });
    assert.equal(lori.interest?.label, "Լոռի");
    assert.equal(lori.interest?.tourId, null);
    assert.match(lori.reply, /Լոռու ուղղությամբ այս պահին տուր չունենք/);
    assert.doesNotMatch(lori.reply, /առաջիկա բաց մեկնում/);
    const tatev = answerTourChat({ message: "Տաթև", facts: facts(), now });
    assert.equal(tatev.interest?.tourId, "tatev");
    assert.match(tatev.reply, /Տաթև առաջիկա բաց մեկնում դեռ չկա/);
    assert.match(tatev.reply, /Ցանկանո՞ւմ ես գրանցել հետաքրքրությունդ/);
    const garni = answerTourChat({ message: "Գառնի", facts: facts(), now });
    assert.equal(garni.interest, null);
    const unclear = answerTourChat({ message: "տուր", facts: facts(), now });
    assert.equal(unclear.interest, null);
    const failed = answerTourChat({ message: "Գառնի", facts: { ok: false, tours: [] }, now });
    assert.equal(failed.interest, null);
    assert.match(failed.reply, /չբեռնվեցին/);
    assert.doesNotMatch(failed.reply, /առաջիկա բաց մեկնում/);
    const unreadable = answerTourChat({
      message: "Գառնիի ազատ տեղերը",
      now,
      facts: publicFactsFromRows(
        [{ id: "garni", title_hy: "Գառնի", price: 12000, departure_time: "08:30", is_virtual_only: false }],
        [{ id: "garni-dep-blank", tour_id: "garni", departure_date: "2026-11-30", available_seats: "x" }],
      ),
    });
    assert.equal(unreadable.interest, null);
    assert.match(unreadable.reply, /չեն բեռնվել/);
    const saved = interestPreviewScenario();
    assert.equal(saved.declined, false);
    assert.equal(saved.registered, true);
    assert.equal(saved.duplicate, true);
    assert.equal(saved.rows, 2);
    assert.equal(saved.notices, 1);
    assert.equal(saved.repeatNotices, 0);
    assert.equal(saved.loriNotified, false);
    assert.match(saved.body, /20 դեկտեմբեր 2026/);
    assert.match(saved.body, /08:30/);
    assert.match(saved.body, /\/tours\/garni/);
    assert.equal(sameInterest([{ key: "լոռի", tourId: null }], { label: "Լոռի", tourId: null }), true);
    assert.equal(sameInterest([{ key: "լոռի", tourId: null }], { label: "Տաթև", tourId: "tatev" }), false);
    assert.equal(sameInterest([{ key: "տաթև", tourId: "tatev" }], { label: "Արմավիր – Տաթև", tourId: "tatev" }), true);
    assert.equal(interestOfferEnabled({}, "production"), false);
    assert.equal(interestOfferEnabled({ TWILIO_ACCOUNT_SID: "AC", TWILIO_AUTH_TOKEN: "token", TWILIO_PHONE_NUMBER: "+37400000000" }, "production"), true);
    assert.equal(interestOfferEnabled({}, "preview"), true);
    assert.equal(interestConfirmation("mock"), "Փորձնական գրանցումը հաջողվեց");
    assert.match(interestConfirmation("live"), /կտեղեկացնեմ քեզ/);
  });

  it("keeps the isolated ticket on the same test tour and open departure", () => {
    const booked = confirmPreviewFixture({
      departureId: "chat-test-open",
      party: 2,
      key: "preview-ticket-key01",
      proof: "preview-ticket-proof",
      expectedPrice: 12000,
      expectedSeats: 4,
      expectedDate: CHAT_TEST_OPEN_DATE,
      expectedCashback: 5,
      now,
    });
    assert.equal(booked.ok, true);
    if (!booked.ok) return;
    assert.equal(booked.tourId, CHAT_TEST_TOUR_ID);
    assert.equal(booked.title, CHAT_TEST_TITLE);
    assert.equal(booked.date, CHAT_TEST_OPEN_DATE);
    assert.equal(booked.dateLabel, "20 դեկտեմբեր 2026");
    const found = findPreviewTicket(booked.ticketCode);
    assert.equal(found?.ticketCode, booked.ticketCode);
    assert.equal(found?.tourId, CHAT_TEST_TOUR_ID);
    assert.equal(found?.title, CHAT_TEST_TITLE);
    assert.equal(found?.date, CHAT_TEST_OPEN_DATE);
    assert.equal(findPreviewTicket("AG-TEST999"), null);
  });

  it("finds a published tour by marz and keeps that tour for the next price question", () => {
    const catalog = publicFactsFromRows(
      [
        { id: "south", title_hy: "Հարավային երթուղի", location_hy: "Տաթև", price: 11000, departure_time: "07:00", is_virtual_only: false },
        { id: "kapan", title_hy: "Կապանի կամուրջ", region: "Սյունիք", price: 9000, departure_time: "08:00", is_virtual_only: false },
      ],
      [],
    );
    for (const message of ["Սյունիք տուր ունեք", "Սյունիքում ի՞նչ տուրեր կան", "դեպի Սյունիք տուր ունե՞ք"]) {
      const several = answerTourChat({ message, facts: catalog, now });
      assert.equal(several.interest, null);
      assert.equal(several.choices?.length, 2);
      assert.match(several.reply, /Ընտրիր մեկը/);
    }
    const one = publicFactsFromRows(
      [{ id: "south", title_hy: "Հարավային երթուղի", location_hy: "Տաթև", price: null, departure_time: "", is_virtual_only: false }],
      [],
    );
    const questions = ["Սյունիք տուր ունեք", "Սյունիքում ի՞նչ տուրեր կան", "դեպի Սյունիք տուր ունե՞ք"];
    for (const message of questions) {
      const answer = answerTourChat({ message, facts: one, now, reading: { intent: "greeting", direction: null, party: null } });
      assert.equal(answer.interest?.tourId, "south");
      assert.match(answer.reply, /Հարավային երթուղի/);
      assert.match(answer.reply, /առաջիկա բաց մեկնում դեռ չկա/);
      assert.match(answer.reply, /\/tours\/south/);
      const price = answerTourChat({
        message: "իսկ գինը՞",
        facts: one,
        now,
        history: [
          { role: "user", text: message },
          { role: "assistant", text: answer.reply },
        ],
      });
      assert.match(price.reply, /Հարավային երթուղի/);
      assert.match(price.reply, /դեռ հրապարակված չէ/);
      assert.doesNotMatch(price.reply, /Ո՞ր տուրի գինն/);
    }
  });

  it("keeps Tatev for the price and the notice after a Syunik question", () => {
    const catalog = facts();
    const first = answerTourChat({ message: "Սյունիք տուր ունե՞ք", facts: catalog, now });
    assert.equal(first.interest?.tourId, "tatev");
    const history = [
      { role: "user" as const, text: "Սյունիք տուր ունե՞ք" },
      { role: "assistant" as const, text: first.reply },
    ];
    const price = answerTourChat({ message: "իսկ գինը՞", facts: catalog, now, history });
    assert.match(price.reply, /Տաթևի տուրի գինը դեռ հրապարակված չէ/);
    const followed = [
      ...history,
      { role: "user" as const, text: "իսկ գինը՞" },
      { role: "assistant" as const, text: price.reply },
    ];
    const notice = answerTourChat({ message: "որ լինի՝ կհիշե՞ք ինձ", facts: catalog, now, history: followed });
    assert.equal(notice.interest?.tourId, "tatev");
    assert.match(notice.reply, /Տաթև/);
    const ignoredGreeting = answerTourChat({
      message: "որ լինի՝ կհիշե՞ք ինձ",
      facts: catalog,
      now,
      history: followed,
      reading: { intent: "greeting", direction: null, party: null },
    });
    assert.equal(ignoredGreeting.interest?.tourId, "tatev");
    const modelNotice = answerTourChat({
      message: "որ լինի՝ կհիշե՞ք ինձ",
      facts: catalog,
      now,
      history: followed,
      reading: { intent: "notice", direction: "Տաթև", party: null },
    });
    assert.equal(modelNotice.interest?.tourId, "tatev");
    const menu = answerTourChat({
      message: "իսկ գինը՞",
      facts: catalog,
      now,
      history,
      shownTourIds: ["garni", "sevan", "tatev"],
    });
    assert.match(menu.reply, /Տաթևի տուրի գինը դեռ հրապարակված չէ/);
    const switched = answerTourChat({
      message: "Գյումրի",
      facts: catalog,
      now,
      history: followed,
      reading: { intent: "notice", direction: "Տաթև", party: null },
    });
    assert.equal(switched.interest?.tourId, null);
    assert.match(switched.reply, /Գյումրի/);
  });
});

describe("telegram chat bucket", () => {
  it("keeps a telegram chat separate only when the server secret matches", () => {
    const previous = process.env["CHAT_INTENT_API_SECRET"];
    process.env["CHAT_INTENT_API_SECRET"] = "1234567890abcdef";
    const accepted = new Request("https://example.test/api/tour-chat", {
      headers: { "x-chat-client": "telegram", "x-api-secret": "1234567890abcdef", "x-chat-id": "42" },
    });
    const rejected = new Request("https://example.test/api/tour-chat", {
      headers: { "x-chat-client": "telegram", "x-api-secret": "zzzzzzzzzzzzzzzz", "x-chat-id": "42" },
    });
    assert.equal(telegramRateKey(accepted), "telegram:42");
    assert.equal(telegramRateKey(rejected), null);
    if (previous === undefined) delete process.env["CHAT_INTENT_API_SECRET"];
    else process.env["CHAT_INTENT_API_SECRET"] = previous;
  });
});

describe("catalog tools for free text", () => {
  it("opens a button section without asking the model", () => {
    const upcoming = openChatSection({ section: "upcoming", facts: facts(), now });
    assert.match(upcoming.reply, /Սևան/);
    assert.equal(upcoming.booking, null);
    const tour = openChatSection({ section: "tour", tourId: "tatev", facts: facts(), now });
    assert.match(tour.reply, /դեռ հրապարակված չէ/);
    assert.match(tour.reply, /բաց մեկնում դեռ չկա/);
    assert.equal(tour.interest?.tourId, "tatev");
    const failed = openChatSection({ section: "directions", facts: { ok: false, tours: [] }, now });
    assert.match(failed.reply, /չհաջողվեց ստանալ/);
  });

  it("keeps a model price only when the total comes from the catalog", () => {
    const priced = publicFactsFromRows(
      [{ id: "lori", title_hy: "Լոռի", price: 9000, departure_time: "08:00", location_hy: "Լոռի", region: "Լոռի", is_virtual_only: false }],
      [{ id: "lori-open", tour_id: "lori", departure_date: "2026-11-20", available_seats: 4 }],
    );
    const accepted = groundChatAnswer({
      reply: "Երկուսով կարժենա 18000 դրամ։ Մեկ անձի համար՝ 9000 դրամ։",
      calls: [{ name: "get_price", tourId: "lori", party: 2, query: null, action: null }],
      suggest: "none",
      facts: priced,
      now,
    });
    assert.equal(accepted.grounded, true);
    assert.match(accepted.reply, /18000/);
    assert.match(accepted.reply, /\/tours\/lori/);
    const invented = groundChatAnswer({
      reply: "Երկուսով կարժենա 5000 դրամ։",
      calls: [{ name: "get_price", tourId: "lori", party: 2, query: null, action: null }],
      suggest: "none",
      facts: priced,
      now,
    });
    assert.match(invented.reply, /18000 դրամ/);
    assert.doesNotMatch(invented.reply, /5000/);
    const missing = groundChatAnswer({
      reply: "Տաթևն արժե 10000 դրամ։",
      calls: [
        { name: "get_price", tourId: "tatev", party: null, query: null, action: null },
        { name: "get_departures", tourId: "tatev", party: null, query: null, action: null },
      ],
      suggest: "interest",
      facts: facts(),
      now,
    });
    assert.match(missing.reply, /Տաթևի տուրի գինը դեռ հրապարակված չէ/);
    assert.match(missing.reply, /բաց մեկնում դեռ չկա/);
    assert.equal(missing.interest?.tourId, "tatev");
    assert.doesNotMatch(missing.reply, /10000/);
  });

  it("searches a region from the catalog and offers a choice when several tours match", () => {
    const catalog = publicFactsFromRows(
      [
        { id: "tatev", title_hy: "Հարավային երթուղի", price: null, location_hy: "Տաթև", region: "Սյունիք", is_virtual_only: false },
        { id: "garni", title_hy: "Գառնի", price: 9000, region: "Կոտայք", is_virtual_only: false },
      ],
      [],
    );
    const one = groundChatAnswer({
      reply: "Գտա մի տուր, արժե 1 դրամ։",
      calls: [{ name: "search_tours", tourId: null, party: null, query: "Սյունիքում", action: null }],
      suggest: "interest",
      facts: catalog,
      now,
    });
    assert.match(one.reply, /Հարավային երթուղի/);
    assert.match(one.reply, /դեռ հրապարակված չէ/);
    assert.equal(one.selectedTourId, "tatev");
    assert.doesNotMatch(one.reply, /1 դրամ/);
  });
});
