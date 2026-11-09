import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMemoryCatalogRemote, loadRemoteCatalog } from "./catalog-persistence";
import { garniGuideAudioUrl, garniGuideDurationSeconds, withPublishedGarniAudio } from "./garni-audio";

const settings = {
  bannerTitle: "Բացահայտիր",
  bannerText: "Տեքստ",
  departurePlace: "Արմավիր",
  cashbackPercent: 5,
};

describe("published Garni audio", () => {
  it("keeps the recording when the Supabase row has no chapters", async () => {
    const remote = createMemoryCatalogRemote({
      tours: [
        {
          id: "garni",
          title_hy: "Գառնի",
          description_hy: "Տաճար",
          location_hy: "Կոտայք",
          price: 12000,
          has_audio_guide: false,
          audio_chapters: [],
        },
      ],
      virtual: [],
      settings: null,
    });
    const loaded = await loadRemoteCatalog(remote, settings);
    assert.equal(loaded.status, "loaded");
    if (loaded.status !== "loaded") return;
    const garni = loaded.tours.find((tour) => tour.id === "garni");
    assert.ok(garni);
    assert.equal(garni.hasAudioGuide, true);
    assert.equal(garni.price, 12000);
    assert.equal(garni.audioChapters.length, 1);
    assert.equal(garni.audioChapters[0]?.audioUrl, garniGuideAudioUrl);
    assert.equal(garni.audioChapters[0]?.duration, garniGuideDurationSeconds);
  });

  it("leaves other tours untouched", () => {
    const sevan = withPublishedGarniAudio({
      id: "sevan",
      hasAudioGuide: false,
      audioChapters: [],
    });
    assert.equal(sevan.hasAudioGuide, false);
    assert.deepEqual(sevan.audioChapters, []);
  });
});
