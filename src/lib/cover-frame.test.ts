import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CENTER_COVER,
  coverObjectPosition,
  coverPositionAfterArrow,
  coverPositionAfterDrag,
  coverPositionFromHotspots,
  hotspotsWithCover,
  visibleHotspots,
} from "./cover-frame.ts";

describe("cover frame", () => {
  it("uses the image center when no position is saved", () => {
    assert.deepEqual(coverPositionFromHotspots([]), CENTER_COVER);
    assert.equal(coverObjectPosition(null), "50% 50%");
    assert.deepEqual(hotspotsWithCover([], CENTER_COVER), []);
  });

  it("keeps one saved position and hides it from visible hotspots", () => {
    const stored = hotspotsWithCover(
      [{ id: "spot", x: 10, y: 20, title: "Տաճար", description: "Մուտք" }],
      { x: 50, y: 38 },
    );
    assert.equal(coverObjectPosition(coverPositionFromHotspots(stored)), "50% 38%");
    assert.deepEqual(
      visibleHotspots(stored).map((item) => item.id),
      ["spot"],
    );
  });

  it("moves only the overflowing axis and keeps the picture filling the frame", () => {
    const next = coverPositionAfterDrag(
      { x: 50, y: 50 },
      40,
      -20,
      { width: 200, height: 100 },
      { width: 100, height: 200 },
    );
    assert.equal(next.x, 50);
    assert.ok(next.y > 50);
  });

  it("moves the picture with the arrow keys and stops at the frame edge", () => {
    assert.deepEqual(coverPositionAfterArrow({ x: 50, y: 50 }, "ArrowRight"), { x: 48, y: 50 });
    assert.deepEqual(coverPositionAfterArrow({ x: 50, y: 50 }, "ArrowDown"), { x: 50, y: 48 });
    assert.equal(coverPositionAfterArrow({ x: 0, y: 0 }, "ArrowRight")?.x, 0);
    assert.equal(coverPositionAfterArrow({ x: 100, y: 100 }, "ArrowUp")?.y, 100);
    assert.equal(coverPositionAfterArrow({ x: 50, y: 50 }, "Enter"), null);
  });
});
