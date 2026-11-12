export const COVER_UPLOAD_ERROR = "Նկարը չվերբեռնվեց։ Նախկին նկարը պահպանված է։";

function safeSegment(value: string, fallback: string) {
  const cleaned = value.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "").replace(/^\.+/, "");
  return cleaned || fallback;
}

export function tourCoverObjectPath(tourId: string, fileName: string, objectId: string) {
  return `covers/${safeSegment(tourId, "tour")}/${objectId}-${safeSegment(fileName, "cover.jpg")}`;
}

export function coverImageToStore(previous: string, uploaded: string | null) {
  const next = uploaded?.trim() ?? "";
  return next || previous;
}
