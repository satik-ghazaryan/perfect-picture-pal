import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { coverImageToStore, tourCoverObjectPath } from "./tour-cover-upload.ts";

describe("tour cover upload", () => {
  it("keeps the previous image when the upload does not return a url", () => {
    assert.equal(coverImageToStore("https://cdn.example/old.jpg", null), "https://cdn.example/old.jpg");
    assert.equal(coverImageToStore("https://cdn.example/old.jpg", "  "), "https://cdn.example/old.jpg");
  });

  it("stores the uploaded url when the upload succeeds", () => {
    assert.equal(
      coverImageToStore("https://cdn.example/old.jpg", "https://cdn.example/new.jpg"),
      "https://cdn.example/new.jpg",
    );
  });

  it("builds a storage path inside the existing album bucket folder", () => {
    assert.equal(tourCoverObjectPath("tatev", "Գառնի photo.jpg", "abc"), "covers/tatev/abc-photo.jpg");
  });
});
