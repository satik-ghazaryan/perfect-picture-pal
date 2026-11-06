import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compareCatalogTours,
  exportPublicCatalog,
  mergeSelectedFields,
  parseCatalogBackup,
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
});
