import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CatalogTour } from "./tour-catalog-record";
import {
  deserializeSiteSettings,
  deserializeTourCatalog,
  deserializeVirtualTour,
  mergeCatalogTours,
  normalizeCatalogTour,
  serializeSiteSettings,
  serializeTourCatalog,
  serializeVirtualTour,
} from "./tour-catalog-record";

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
    departurePlace: "Արմավիր քաղաք, Կենտրոնական հրապարակ",
    departureTime: "08:30",
    returnTime: "19:00",
    price: 18000,
    seatsLeft: 17,
    rating: 5,
    reviews: 0,
    has360: false,
    hasAudioGuide: true,
    day: "saturday",
    highlights: ["Տաճար"],
    itinerary: [{ time: "10:00", title: "Գառնի", description: "Շրջայց" }],
    included: ["Ավտոբուս"],
    excluded: ["Ճաշ"],
    audioChapters: [{ id: "ch-1", title: "Մեկնում", duration: 90, language: "hy" }],
    hotspots: [{ id: "hs-1", x: 10, y: 20, title: "Տաճար", description: "Հելլենիստական" }],
    panoramaUrl: "",
    is_virtual_only: false,
    virtual_tour_id: "vr-garni",
    guideId: null,
    driverId: null,
    ...overrides,
  };
}

describe("tour catalog mapping", () => {
  it("round-trips a full physical tour including virtual_tour_id", () => {
    const saved = sampleTour();
    const row = serializeTourCatalog(saved);
    const loaded = deserializeTourCatalog(row);
    assert.ok(loaded);
    assert.equal(loaded.id, saved.id);
    assert.equal(loaded.title_hy, saved.title_hy);
    assert.equal(loaded.description_en, "");
    assert.equal(loaded.type, "Մշակութային");
    assert.equal(loaded.day, "saturday");
    assert.equal(loaded.departureTime, "08:30");
    assert.equal(loaded.returnTime, "19:00");
    assert.deepEqual(loaded.itinerary, saved.itinerary);
    assert.deepEqual(loaded.highlights, saved.highlights);
    assert.deepEqual(loaded.included, saved.included);
    assert.deepEqual(loaded.excluded, saved.excluded);
    assert.equal(loaded.audioChapters[0]?.title, "Մեկնում");
    assert.equal(loaded.hotspots[0]?.x, 10);
    assert.equal(loaded.virtual_tour_id, "vr-garni");
    assert.equal(row.title, saved.title_hy);
    assert.equal(row.summary, saved.description_hy);
  });

  it("keeps empty strings and zero numbers instead of seed values", () => {
    const saved = sampleTour({
      id: "garni-geghard",
      title_en: "",
      title_ru: "",
      description_hy: "",
      price: 0,
      reviews: 0,
      highlights: [],
      itinerary: [],
      included: [],
      excluded: [],
      audioChapters: [],
      hotspots: [],
      virtual_tour_id: null,
    });
    const loaded = deserializeTourCatalog(serializeTourCatalog(saved));
    assert.ok(loaded);
    assert.equal(loaded.title_en, "");
    assert.equal(loaded.description_hy, "");
    assert.equal(loaded.price, 0);
    assert.equal(loaded.reviews, 0);
    assert.deepEqual(loaded.highlights, []);
    assert.deepEqual(loaded.itinerary, []);
    assert.equal(loaded.virtual_tour_id, null);
    const omitted = normalizeCatalogTour(
      { id: "garni", title_hy: "Գառնի" },
      true,
      sampleTour({ id: "garni", price: 22000 }),
    );
    assert.ok(omitted);
    assert.ok((omitted.price ?? 0) > 0);
  });

  it("restores a virtual tour and a physical link without duplicating ids", () => {
    const virtual = deserializeVirtualTour({
      id: "vr-garni",
      title_hy: "Գառնի 360",
      title_en: "",
      title_ru: "",
      description_hy: "",
      description_en: "",
      description_ru: "",
      embed_url: "https://example.com/pano.jpg",
      thumbnail_url: "https://example.com/thumb.jpg",
    });
    assert.ok(virtual);
    assert.equal(virtual.is_virtual_only, true);
    assert.equal(virtual.panoramaUrl, "https://example.com/pano.jpg");
    const physical = deserializeTourCatalog(serializeTourCatalog(sampleTour()));
    assert.ok(physical);
    const merged = mergeCatalogTours([physical], [virtual]);
    assert.equal(merged.length, 2);
    assert.equal(merged.filter((tour) => tour.id === "vr-garni").length, 1);
    assert.equal(merged.find((tour) => tour.id === "garni-new")?.virtual_tour_id, "vr-garni");
    const virtualRow = serializeVirtualTour(virtual);
    assert.equal(virtualRow.embed_url, "https://example.com/pano.jpg");
    assert.equal(virtualRow.title, "Գառնի 360");
    assert.equal(virtualRow.panorama_url, "https://example.com/pano.jpg");
  });

  it("loads legacy virtual rows with empty localized and embed fields", () => {
    const loaded = deserializeVirtualTour({
      id: "legacy-vr",
      title: "Հին վիրտուալ",
      summary: "Հին նկարագրություն",
      panorama_url: "https://example.com/old.jpg",
      hotspots: [{ id: "hs-1", x: 1, y: 2, title: "Կետ", description: "Նկար" }],
    });
    assert.ok(loaded);
    assert.equal(loaded.title_hy, "Հին վիրտուալ");
    assert.equal(loaded.description_hy, "Հին նկարագրություն");
    assert.equal(loaded.panoramaUrl, "https://example.com/old.jpg");
    assert.equal(loaded.hotspots[0]?.id, "hs-1");
    const payload = serializeVirtualTour(loaded);
    assert.equal(payload.title, "Հին վիրտուալ");
    assert.ok(payload.title.length > 0);
  });

  it("round-trips site settings including cashback 0", () => {
    const row = serializeSiteSettings({
      bannerTitle: "Վերնագիր",
      bannerText: "Տեքստ",
      departurePlace: "Արմավիր",
      cashbackPercent: 0,
    });
    const loaded = deserializeSiteSettings(row, {
      bannerTitle: "fallback",
      bannerText: "fallback",
      departurePlace: "fallback",
      cashbackPercent: 5,
    });
    assert.ok(loaded);
    assert.equal(loaded.cashbackPercent, 0);
    assert.equal(loaded.bannerTitle, "Վերնագիր");
  });
});
