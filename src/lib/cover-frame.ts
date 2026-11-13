import type { Hotspot } from "@/data/tours";

export type CoverPosition = { x: number; y: number };

export const CENTER_COVER: CoverPosition = { x: 50, y: 50 };
export const COVER_HOTSPOT_ID = "__cover__";

export function clampCover(value: number) {
  if (!Number.isFinite(value)) return 50;
  return Math.min(100, Math.max(0, Math.round(value * 10) / 10));
}

export function coverObjectPosition(position?: CoverPosition | null) {
  const point = position ?? CENTER_COVER;
  return `${clampCover(point.x)}% ${clampCover(point.y)}%`;
}

export function coverPositionFromHotspots(hotspots: Hotspot[]): CoverPosition {
  const mark = hotspots.find((item) => item.id === COVER_HOTSPOT_ID);
  if (!mark) return { ...CENTER_COVER };
  return { x: clampCover(mark.x), y: clampCover(mark.y) };
}

export function visibleHotspots(hotspots: Hotspot[]) {
  return hotspots.filter((item) => item.id !== COVER_HOTSPOT_ID);
}

export function hotspotsWithCover(hotspots: Hotspot[], position?: CoverPosition | null) {
  const clean = visibleHotspots(hotspots);
  const point = position ?? CENTER_COVER;
  if (point.x === 50 && point.y === 50) return clean;
  return [
    ...clean,
    { id: COVER_HOTSPOT_ID, x: clampCover(point.x), y: clampCover(point.y), title: "", description: "" },
  ];
}

export function coverPositionAfterDrag(
  start: CoverPosition,
  dx: number,
  dy: number,
  frame: { width: number; height: number },
  image: { width: number; height: number },
): CoverPosition {
  if (frame.width <= 0 || frame.height <= 0 || image.width <= 0 || image.height <= 0) return start;
  const scale = Math.max(frame.width / image.width, frame.height / image.height);
  return {
    x: moveAxis(start.x, dx, frame.width, image.width * scale),
    y: moveAxis(start.y, dy, frame.height, image.height * scale),
  };
}

export function coverPositionAfterArrow(position: CoverPosition, key: string, step = 2): CoverPosition | null {
  if (key === "ArrowLeft") return { x: clampCover(position.x + step), y: position.y };
  if (key === "ArrowRight") return { x: clampCover(position.x - step), y: position.y };
  if (key === "ArrowUp") return { x: position.x, y: clampCover(position.y + step) };
  if (key === "ArrowDown") return { x: position.x, y: clampCover(position.y - step) };
  return null;
}

function moveAxis(startPercent: number, delta: number, frame: number, rendered: number) {
  const overflow = rendered - frame;
  if (overflow <= 1) return clampCover(startPercent);
  const oldOffset = (frame - rendered) * (startPercent / 100);
  const nextOffset = Math.min(0, Math.max(frame - rendered, oldOffset + delta));
  return clampCover((nextOffset / (frame - rendered)) * 100);
}
