import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createMemoryCatalogRemote,
  loadRemoteCatalog,
  persistCatalogSettings,
  persistCatalogTour,
} from "./catalog-persistence";
import type { CatalogTour } from "./tour-catalog-record";
import { mergeSelectedFields } from "./catalog-transfer";
import {
  catalogAfterSave,
  serializeTourCatalog,
  serializeVirtualTour,
} from "./tour-catalog-record";

const fallbackSettings = {
  bannerTitle: "Բացահայտիր",
  bannerText: "Տեքստ",
  departurePlace: "Արմավիր քաղաք, Կենտրոնական հրապարակ",
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
    has360: true,
    hasAudioGuide: true,
    day: "saturday",
    highlights: ["Տաճար"],
    itinerary: [{ time: "10:00", title: "Գառնի", description: "Շրջայց" }],
    included: ["Ավտոբուս"],
    excluded: ["Ճաշ"],
    audioChapters: [{ id: "ch-1", title: "Մեկնում", duration: 90, language: "hy" }],
    hotspots: [{ id: "hs-1", x: 10, y: 20, title: "Տաճար", description: "Հելլենիստական" }],
    panoramaUrl: "https://example.com/pano.jpg",
    is_virtual_only: false,
    virtual_tour_id: null,
    guideId: null,
    driverId: null,
    ...overrides,
  };
}

describe("catalog persistence", () => {
  it("does not commit a local catalog change when upsert fails", async () => {
    const remote = createMemoryCatalogRemote({ failTourUpsert: true });
    const current = [sampleTour({ id: "kept", title_hy: "Պահված" })];
    await assert.rejects(() => persistCatalogTour(remote, sampleTour()), /չպահպանվեց/);
    assert.equal(remote.store.tours.length, 0);
    assert.equal(current.length, 1);
    assert.equal(current[0]?.title_hy, "Պահված");
  });

  it("round-trips saved fields after a successful load", async () => {
    const remote = createMemoryCatalogRemote();
    const saved = sampleTour();
    await persistCatalogTour(remote, saved);
    const next = catalogAfterSave([], [saved]);
    const loaded = await loadRemoteCatalog(remote, fallbackSettings);
    assert.equal(loaded.status, "loaded");
    if (loaded.status !== "loaded") return;
    assert.equal(next[0]?.audioChapters[0]?.title, "Մեկնում");
    assert.equal(loaded.tours[0]?.title_hy, "Գառնի");
    assert.equal(loaded.tours[0]?.departurePlace, "Արմավիր հրապարակ");
    assert.deepEqual(loaded.tours[0]?.itinerary, saved.itinerary);
    assert.equal(loaded.tours[0]?.hotspots[0]?.id, "hs-1");
  });

  it("treats an empty remote catalog as a successful empty load, not demo data", async () => {
    const remote = createMemoryCatalogRemote();
    const loaded = await loadRemoteCatalog(remote, fallbackSettings);
    assert.equal(loaded.status, "loaded");
    if (loaded.status !== "loaded") return;
    assert.equal(loaded.tours.length, 0);
  });

  it("keeps load errors distinct from an empty success", async () => {
    const remote = createMemoryCatalogRemote({ failLoad: true });
    const loaded = await loadRemoteCatalog(remote, fallbackSettings);
    assert.equal(loaded.status, "error");
  });

  it("writes virtual payload with the legacy required title column", async () => {
    const remote = createMemoryCatalogRemote();
    const virtual = sampleTour({
      id: "vr-garni",
      is_virtual_only: true,
      title_hy: "Գառնի 360",
      panoramaUrl: "https://example.com/pano.jpg",
    });
    await persistCatalogTour(remote, virtual);
    const row = remote.store.virtual[0];
    assert.equal(row?.["title"], "Գառնի 360");
    assert.ok(typeof row?.["title"] === "string" && String(row["title"]).length > 0);
    assert.equal(row?.["panorama_url"], "https://example.com/pano.jpg");
    assert.equal(row?.["embed_url"], "https://example.com/pano.jpg");
    const serialized = serializeVirtualTour(virtual);
    assert.equal(serialized.title, "Գառնի 360");
  });

  it("does not delete a same-id row in the other table", async () => {
    const remote = createMemoryCatalogRemote({
      tours: [{ id: "shared", title: "Ֆիզիկական" }],
    });
    await persistCatalogTour(
      remote,
      sampleTour({
        id: "shared",
        is_virtual_only: true,
        title_hy: "Վիրտուալ",
        panoramaUrl: "https://example.com/pano.jpg",
      }),
    );
    assert.equal(remote.store.tours.length, 1);
    assert.equal(remote.store.tours[0]?.["title"], "Ֆիզիկական");
    assert.equal(remote.store.virtual[0]?.["title"], "Վիրտուալ");
  });

  it("loads a legacy sunday date when day is missing", async () => {
    const remote = createMemoryCatalogRemote({
      tours: [
        {
          id: "old-sunday",
          title_hy: "Հին տուր",
          day: null,
          departure_date: "2026-11-08",
          image_url: "https://example.com/old.jpg",
          price: 10000,
        },
      ],
    });
    const loaded = await loadRemoteCatalog(remote, fallbackSettings);
    assert.equal(loaded.status, "loaded");
    if (loaded.status !== "loaded") return;
    assert.equal(loaded.tours[0]?.day, "sunday");
  });

  it("does not treat a weekday legacy date as a confirmed saturday departure", async () => {
    const remote = createMemoryCatalogRemote({
      tours: [
        {
          id: "old-weekday",
          title_hy: "Չորեքշաբթի",
          day: null,
          departure_date: "2026-11-11",
          image_url: "https://example.com/old.jpg",
          price: 10000,
        },
      ],
    });
    const loaded = await loadRemoteCatalog(remote, fallbackSettings);
    assert.equal(loaded.status, "loaded");
    if (loaded.status !== "loaded") return;
    assert.equal(loaded.tours[0]?.day, "");
    const row = serializeTourCatalog(loaded.tours[0]!);
    assert.equal(row.day, null);
  });

  it("round-trips selected empty audio and panorama after save", async () => {
    const remote = createMemoryCatalogRemote({
      tours: [
        serializeTourCatalog(
          sampleTour({
            hasAudioGuide: true,
            audioChapters: [{ id: "ch-1", title: "Մեկնում", duration: 90, language: "hy" }],
            has360: true,
            panoramaUrl: "https://example.com/pano.jpg",
            virtual_tour_url: "https://example.com/embed.jpg",
            virtual_tour_id: "vr-keep",
          }),
        ) as unknown as Record<string, unknown>,
      ],
    });
    const current = await loadRemoteCatalog(remote, fallbackSettings);
    assert.equal(current.status, "loaded");
    if (current.status !== "loaded") return;
    const localEmpty = sampleTour({
      hasAudioGuide: true,
      audioChapters: [],
      panoramaUrl: "",
      virtual_tour_url: "",
      virtual_tour_id: "vr-keep",
    });
    const mergedAudio = mergeSelectedFields(current.tours[0]!, localEmpty, ["audioChapters"]);
    await persistCatalogTour(remote, mergedAudio);
    const afterAudio = await loadRemoteCatalog(remote, fallbackSettings);
    assert.equal(afterAudio.status, "loaded");
    if (afterAudio.status !== "loaded") return;
    assert.equal(afterAudio.tours[0]?.hasAudioGuide, false);
    assert.equal(afterAudio.tours[0]?.audioChapters.length, 0);

    const mergedPanorama = mergeSelectedFields(afterAudio.tours[0]!, localEmpty, ["panorama"]);
    await persistCatalogTour(remote, mergedPanorama);
    const afterPanorama = await loadRemoteCatalog(remote, fallbackSettings);
    assert.equal(afterPanorama.status, "loaded");
    if (afterPanorama.status !== "loaded") return;
    assert.equal(afterPanorama.tours[0]?.panoramaUrl, "");
    assert.equal(afterPanorama.tours[0]?.virtual_tour_url ?? "", "");
    assert.equal(afterPanorama.tours[0]?.virtual_tour_id, "vr-keep");
    assert.equal(afterPanorama.tours[0]?.has360, true);
  });

  it("keeps each tour departure place after settings save and reload", async () => {
    const remote = createMemoryCatalogRemote({
      tours: [
        serializeTourCatalog(sampleTour({ departurePlace: "Գյուղի կանգառ" })) as unknown as Record<
          string,
          unknown
        >,
      ],
    });
    await persistCatalogSettings(remote, {
      ...fallbackSettings,
      departurePlace: "Նոր լռելյայն հասցե",
    });
    const loaded = await loadRemoteCatalog(remote, fallbackSettings);
    assert.equal(loaded.status, "loaded");
    if (loaded.status !== "loaded") return;
    assert.equal(loaded.settings.departurePlace, "Նոր լռելյայն հասցե");
    assert.equal(loaded.tours[0]?.departurePlace, "Գյուղի կանգառ");
  });
});
