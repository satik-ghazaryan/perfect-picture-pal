import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyTransferOperations,
  compareCatalogTours,
  createTourFromLocal,
  exportPublicCatalog,
  mergeSelectedFields,
  parseCatalogBackup,
  remainingTransferOperations,
} from "./catalog-transfer";
import type { CatalogTour } from "./tour-catalog-record";

const settings = {
  bannerTitle: "Վերնագիր",
  bannerText: "Տեքստ",
  departurePlace: "Արմավիր",
  cashbackPercent: 5,
};

function sampleTour(overrides: Partial<CatalogTour> = {}): CatalogTour {
  return {
    id: "garni-new",
    title_hy: "Գառնի",
    title_en: "Garni",
    title_ru: "Гарни",
    description_hy: "Նկարագրություն",
    description_en: "",
    description_ru: "",
    location_hy: "Կոտայք",
    location_en: "",
    location_ru: "",
    image_url: "https://example.com/garni.jpg",
    category: "Կոտայք",
    type: "Մշակութային",
    departurePlace: "Արմավիր հրապարակ",
    departureTime: "08:30",
    returnTime: "19:00",
    price: 18000,
    seatsLeft: 17,
    rating: 5,
    reviews: 0,
    has360: false,
    hasAudioGuide: false,
    day: "saturday",
    highlights: ["Տաճար"],
    itinerary: [],
    included: [],
    excluded: [],
    audioChapters: [],
    hotspots: [],
    panoramaUrl: "",
    is_virtual_only: false,
    virtual_tour_id: null,
    guideId: null,
    driverId: null,
    ...overrides,
  };
}

describe("catalog transfer", () => {
  it("does not export users, tokens, or passwords", () => {
    const backup = exportPublicCatalog([sampleTour({ guideId: "staff-1" })], settings);
    const raw = JSON.stringify(backup);
    assert.equal("users" in backup, false);
    assert.doesNotMatch(raw, /password|token|session/i);
    assert.equal(backup.tours[0]?.guideId, null);
  });

  it("strips users and secrets from imported JSON and does not auto-overwrite conflicts", () => {
    const parsed = parseCatalogBackup(
      JSON.stringify({
        users: [{ id: "u1", password: "secret", token: "abc" }],
        session: { token: "abc" },
        token: "abc",
        settings,
        tours: [{ ...sampleTour({ title_hy: "Տեղային Գառնի" }), password: "secret" }],
      }),
    );
    assert.ok(parsed.backup);
    assert.ok(parsed.warnings.some((item) => item.includes("users")));
    assert.ok(parsed.warnings.some((item) => item.includes("սեսիա") || item.includes("գաղտնաբառ")));
    assert.equal("users" in (parsed.backup ?? {}), false);
    const remote = sampleTour({ title_hy: "Հեռավար Գառնի", description_hy: "" });
    const rows = compareCatalogTours(parsed.backup?.tours ?? [], [remote]);
    const both = rows.find((row) => row.id === "garni-new");
    assert.equal(both?.kind, "both");
    const titleDiff = both?.diffs.find((diff) => diff.field === "title");
    assert.equal(titleDiff?.same, false);
    const mergedUnselected = mergeSelectedFields(
      remote,
      parsed.backup?.tours[0] as CatalogTour,
      [],
    );
    assert.equal(mergedUnselected.title_hy, "Հեռավար Գառնի");
    const emptyRemoteDescription = both?.diffs.find((diff) => diff.field === "description");
    assert.equal(emptyRemoteDescription?.same, false);
    assert.equal(emptyRemoteDescription?.remote.includes("Նկարագրություն"), false);
  });

  it("syncs audio and panorama flags, including intentional empty values", () => {
    const remote = sampleTour({
      hasAudioGuide: true,
      audioChapters: [{ id: "ch-1", title: "Մեկնում", duration: 90, language: "hy" }],
      has360: true,
      panoramaUrl: "https://example.com/pano.jpg",
      virtual_tour_url: "https://example.com/embed.jpg",
      virtual_tour_id: "vr-keep",
    });
    const local = sampleTour({
      hasAudioGuide: true,
      audioChapters: [],
      panoramaUrl: "",
      virtual_tour_url: "",
      virtual_tour_id: "vr-keep",
    });
    const merged = mergeSelectedFields(remote, local, ["audioChapters", "panorama"]);
    assert.equal(merged.hasAudioGuide, false);
    assert.deepEqual(merged.audioChapters, []);
    assert.equal(merged.panoramaUrl, "");
    assert.equal(merged.virtual_tour_url ?? "", "");
    assert.equal(merged.virtual_tour_id, "vr-keep");
    assert.equal(merged.has360, true);
    const priceKept = mergeSelectedFields(remote, sampleTour({ price: 1, hasAudioGuide: false }), [
      "price",
    ]);
    assert.equal(priceKept.hasAudioGuide, true);
    assert.equal(priceKept.panoramaUrl, "https://example.com/pano.jpg");
  });

  it("does not copy unselected fields when creating from local requires an explicit create", () => {
    const local = sampleTour({
      id: "new-tour",
      title_hy: "Նոր տուր",
      price: 22000,
      itinerary: [{ time: "10:00", title: "Կանգառ", description: "Նկար" }],
    });
    const rows = compareCatalogTours([local], []);
    assert.equal(rows[0]?.kind, "local-only");
    assert.equal(rows[0]?.diffs.length, 0);
    const created = createTourFromLocal(local);
    assert.equal(created.price, 22000);
    const titleOnly = mergeSelectedFields(
      sampleTour({ id: "garni-new", title_hy: "Հեռավար", price: 1000, itinerary: [] }),
      sampleTour({
        title_hy: "Տեղային",
        price: 22000,
        itinerary: [{ time: "10:00", title: "Կանգառ", description: "Նկար" }],
      }),
      ["title"],
    );
    assert.equal(titleOnly.title_hy, "Տեղային");
    assert.equal(titleOnly.price, 1000);
    assert.equal(titleOnly.itinerary.length, 0);
  });

  it("flags same-id physical and virtual tours as a type conflict", () => {
    const rows = compareCatalogTours(
      [sampleTour({ id: "shared", is_virtual_only: true, title_hy: "Վիրտուալ" })],
      [sampleTour({ id: "shared", is_virtual_only: false, title_hy: "Սովորական" })],
    );
    assert.equal(rows[0]?.kind, "type-conflict");
  });

  it("retries only the failed transfer operation", async () => {
    const localA = sampleTour({ id: "tour-a", title_hy: "Ա" });
    const localB = sampleTour({ id: "tour-b", title_hy: "Բ" });
    const remoteA = sampleTour({ id: "tour-a", title_hy: "Հին Ա" });
    const remoteB = sampleTour({ id: "tour-b", title_hy: "Հին Բ" });
    const savedIds: string[] = [];
    const save = async (tour: CatalogTour) => {
      if (tour.id === "tour-b") throw new Error("upsert failed");
      savedIds.push(tour.id);
    };
    const operations = [
      { id: "tour-a", action: "update-fields" as const, fields: ["title" as const] },
      { id: "tour-b", action: "update-fields" as const, fields: ["title" as const] },
    ];
    const first = await applyTransferOperations(operations, {
      localById: new Map([
        ["tour-a", localA],
        ["tour-b", localB],
      ]),
      remoteById: new Map([
        ["tour-a", remoteA],
        ["tour-b", remoteB],
      ]),
      save,
    });
    assert.deepEqual(
      first.saved.map((item) => item.id),
      ["tour-a"],
    );
    assert.deepEqual(
      first.failed.map((item) => item.operation.id),
      ["tour-b"],
    );
    const leftover = remainingTransferOperations(operations, first.saved);
    assert.deepEqual(
      leftover.map((item) => item.id),
      ["tour-b"],
    );
    let threw = false;
    const secondSave = async (tour: CatalogTour) => {
      if (tour.id === "tour-a") throw new Error("should not save A again");
      threw = true;
      throw new Error("upsert failed");
    };
    const second = await applyTransferOperations(leftover, {
      localById: new Map([
        ["tour-a", localA],
        ["tour-b", localB],
      ]),
      remoteById: new Map([
        ["tour-a", remoteA],
        ["tour-b", remoteB],
      ]),
      save: secondSave,
    });
    assert.equal(savedIds.includes("tour-a"), true);
    assert.equal(savedIds.includes("tour-b"), false);
    assert.equal(second.saved.length, 0);
    assert.equal(second.failed[0]?.operation.id, "tour-b");
    assert.equal(threw, true);
  });
});
