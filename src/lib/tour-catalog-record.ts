import type { AudioChapter, Hotspot, ItineraryStop, Tour } from "@/data/tours";
import { localized, type LocalizedText } from "@/lib/locale";

export const TOUR_CATALOG_TYPES = ["Արշավային", "Մշակութային", "Էքստրեմալ"] as const;
export type TourCatalogType = (typeof TOUR_CATALOG_TYPES)[number];

export type CatalogTour = Tour & {
  panoramaUrl: string;
  guideId: string | null;
  driverId: string | null;
};

export type TourCatalogRow = {
  id: string;
  title: string;
  title_hy: string;
  title_en: string;
  title_ru: string;
  description_hy: string;
  description_en: string;
  description_ru: string;
  location_hy: string;
  location_en: string;
  location_ru: string;
  summary: string;
  region: string;
  price: number;
  image_url: string | null;
  category: string | null;
  type: TourCatalogType | null;
  day: "saturday" | "sunday" | null;
  departure_place: string;
  departure_time: string;
  return_time: string;
  old_price: number | null;
  rating: number | null;
  reviews: number;
  has360: boolean;
  has_audio_guide: boolean;
  highlights: string[];
  itinerary: ItineraryStop[];
  included: string[];
  excluded: string[];
  audio_chapters: AudioChapter[];
  hotspots: Hotspot[];
  panorama_url: string | null;
  virtual_tour_url: string | null;
  is_virtual_only: boolean;
  virtual_tour_id: string | null;
  seats: number;
};

export type VirtualTourRow = {
  id: string;
  title: string;
  title_hy: string;
  title_en: string;
  title_ru: string;
  description_hy: string;
  description_en: string;
  description_ru: string;
  summary: string;
  embed_url: string | null;
  thumbnail_url: string | null;
  image_url: string | null;
  panorama_url: string | null;
  virtual_tour_url: string | null;
  hotspots: Hotspot[];
};

export type SiteSettingsRecord = {
  bannerTitle: string;
  bannerText: string;
  departurePlace: string;
  cashbackPercent: number;
};

export type SiteSettingsRow = {
  id: number;
  banner_title: string;
  banner_text: string;
  departure_place: string;
  cashback_percent: number;
};

export type RemoteErrorParts = {
  code: string;
  message: string;
  details: string;
};

export const defaultSiteSettingsRecord: SiteSettingsRecord = {
  bannerTitle: "Բացահայտիր Հայաստանը\nմեկ օրում",
  bannerText:
    "Հնագույն վանքեր, լեռնային լճեր ու անմոռանալի տեսարաններ՝ փոքր խմբերով ճանապարհորդություններ, որոնք սկսվում են Արմավիրից։",
  departurePlace: "Արմավիր քաղաք, Կենտրոնական հրապարակ",
  cashbackPercent: 5,
};

const emptyLocalized = localized("");

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function optionalText(value: unknown): string | null {
  if (value == null) return null;
  return typeof value === "string" ? value : null;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const digits = value.replace(/[^\d-]/g, "");
    if (!digits) return null;
    const parsed = Number.parseInt(digits, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isStop(value: unknown): value is ItineraryStop {
  const row = asRecord(value);
  if (!row) return false;
  return typeof row["time"] === "string" && typeof row["title"] === "string" && typeof row["description"] === "string";
}

function isHotspot(value: unknown): value is Hotspot {
  const row = asRecord(value);
  if (!row) return false;
  return (
    typeof row["id"] === "string" &&
    typeof row["title"] === "string" &&
    typeof row["description"] === "string" &&
    typeof row["x"] === "number" &&
    typeof row["y"] === "number"
  );
}

function readChapter(value: unknown): AudioChapter | null {
  const chapter = asRecord(value);
  if (!chapter) return null;
  const id = chapter["id"];
  const title = chapter["title"];
  const duration = chapter["duration"];
  if (typeof id !== "string" || typeof title !== "string" || typeof duration !== "number") return null;
  const next: AudioChapter = { id, title, duration };
  const audioUrl = chapter["audioUrl"];
  if (typeof audioUrl === "string" && audioUrl.trim()) next.audioUrl = audioUrl.trim();
  const language = chapter["language"];
  if (language === "hy" || language === "en" || language === "ru") next.language = language;
  return next;
}

function stringsOf(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback;
  return value.filter((item): item is string => typeof item === "string");
}

function readLocalized(value: unknown, fallback: LocalizedText, fillFromSeed: boolean): LocalizedText {
  if (value == null || value === "") return fallback;
  const next = localized(value);
  if (!next.hy.trim()) next.hy = fallback.hy;
  if (fillFromSeed && typeof value === "string") {
    if (!next.en.trim()) next.en = fallback.en;
    if (!next.ru.trim()) next.ru = fallback.ru;
  }
  return next;
}

function readColumn(value: unknown, fallback: string, seedFallback: boolean) {
  if (typeof value !== "string") return seedFallback ? fallback : "";
  if (seedFallback && !value.trim()) return fallback;
  return value;
}

function readTriplet(
  raw: Record<string, unknown>,
  hyKey: string,
  enKey: string,
  ruKey: string,
  objectKey: string,
  fallback: LocalizedText,
  seedFallback: boolean,
) {
  const fromObject = readLocalized(raw[objectKey], fallback, seedFallback);
  return {
    hy: readColumn(raw[hyKey], fromObject.hy || fallback.hy, seedFallback),
    en: readColumn(raw[enKey], fromObject.en || fallback.en, seedFallback),
    ru: readColumn(raw[ruKey], fromObject.ru || fallback.ru, seedFallback),
  };
}

function catalogTypeOf(value: unknown, fallback: TourCatalogType): TourCatalogType {
  return value === "Արշավային" || value === "Մշակութային" || value === "Էքստրեմալ" ? value : fallback;
}

function weekendOf(value: unknown, fallback: "saturday" | "sunday"): "saturday" | "sunday" {
  return value === "sunday" || value === "saturday" ? value : fallback;
}

export function serializeTourCatalog(tour: CatalogTour): TourCatalogRow {
  const virtualUrl = tour.virtual_tour_url?.trim() || tour.panoramaUrl.trim() || null;
  const linked = tour.virtual_tour_id?.trim() && tour.virtual_tour_id.trim() !== tour.id ? tour.virtual_tour_id.trim() : null;
  return {
    id: tour.id,
    title: tour.title_hy,
    title_hy: tour.title_hy,
    title_en: tour.title_en,
    title_ru: tour.title_ru,
    description_hy: tour.description_hy,
    description_en: tour.description_en,
    description_ru: tour.description_ru,
    location_hy: tour.location_hy,
    location_en: tour.location_en,
    location_ru: tour.location_ru,
    summary: tour.description_hy,
    region: tour.location_hy,
    price: tour.price,
    image_url: tour.image_url || null,
    category: tour.category || tour.location_hy || null,
    type: tour.type,
    day: tour.day,
    departure_place: tour.departurePlace,
    departure_time: tour.departureTime,
    return_time: tour.returnTime,
    old_price: tour.oldPrice ?? null,
    rating: tour.rating,
    reviews: tour.reviews,
    has360: tour.has360,
    has_audio_guide: tour.hasAudioGuide,
    highlights: tour.highlights,
    itinerary: tour.itinerary,
    included: tour.included,
    excluded: tour.excluded,
    audio_chapters: tour.audioChapters,
    hotspots: tour.hotspots,
    panorama_url: tour.panoramaUrl || null,
    virtual_tour_url: virtualUrl,
    is_virtual_only: tour.is_virtual_only === true,
    virtual_tour_id: tour.is_virtual_only === true ? null : linked,
    seats: tour.seatsLeft,
  };
}

export function serializeVirtualTour(tour: CatalogTour): VirtualTourRow {
  const embed = tour.virtual_tour_url?.trim() || tour.panoramaUrl.trim() || null;
  const title = tour.title_hy.trim() || tour.id;
  return {
    id: tour.id,
    title,
    title_hy: tour.title_hy,
    title_en: tour.title_en,
    title_ru: tour.title_ru,
    description_hy: tour.description_hy,
    description_en: tour.description_en,
    description_ru: tour.description_ru,
    summary: tour.description_hy,
    embed_url: embed,
    thumbnail_url: tour.image_url || null,
    image_url: tour.image_url || null,
    panorama_url: tour.panoramaUrl || embed,
    virtual_tour_url: embed,
    hotspots: tour.hotspots,
  };
}

export function serializeSiteSettings(settings: SiteSettingsRecord): SiteSettingsRow {
  return {
    id: 1,
    banner_title: settings.bannerTitle,
    banner_text: settings.bannerText,
    departure_place: settings.departurePlace,
    cashback_percent: Math.min(100, Math.max(0, Math.round(settings.cashbackPercent))),
  };
}

export function deserializeSiteSettings(row: unknown, fallback: SiteSettingsRecord): SiteSettingsRecord | null {
  const raw = asRecord(row);
  if (!raw) return null;
  const bannerTitle = textOf(raw["banner_title"] ?? raw["bannerTitle"]);
  const bannerText = textOf(raw["banner_text"] ?? raw["bannerText"]);
  const departurePlace = textOf(raw["departure_place"] ?? raw["departurePlace"]);
  const cashback = finiteNumber(raw["cashback_percent"] ?? raw["cashbackPercent"]);
  if (!bannerTitle && !bannerText && !departurePlace && cashback == null) return null;
  return {
    bannerTitle: bannerTitle || fallback.bannerTitle,
    bannerText: bannerText || fallback.bannerText,
    departurePlace: departurePlace || fallback.departurePlace,
    cashbackPercent: cashback == null ? fallback.cashbackPercent : Math.min(100, Math.max(0, Math.round(cashback))),
  };
}

export function normalizeCatalogTour(value: unknown, seedFallback: boolean, seed?: CatalogTour | null): CatalogTour | null {
  const raw = asRecord(value);
  if (!raw || typeof raw["id"] !== "string") return null;
  const id = raw["id"];
  const base = seedFallback ? seed ?? null : null;
  const title = readTriplet(
    raw,
    "title_hy",
    "title_en",
    "title_ru",
    "title",
    base ? { hy: base.title_hy, en: base.title_en, ru: base.title_ru } : emptyLocalized,
    seedFallback,
  );
  if (!title.hy.trim()) return null;
  const description = readTriplet(
    raw,
    "description_hy",
    "description_en",
    "description_ru",
    "summary",
    base ? { hy: base.description_hy, en: base.description_en, ru: base.description_ru } : emptyLocalized,
    seedFallback,
  );
  const location = readTriplet(
    raw,
    "location_hy",
    "location_en",
    "location_ru",
    "region",
    base ? { hy: base.location_hy, en: base.location_en, ru: base.location_ru } : emptyLocalized,
    seedFallback,
  );
  const imageRaw = raw["image_url"] ?? raw["image"];
  const image = typeof imageRaw === "string" ? imageRaw : seedFallback ? (base?.image_url ?? "") : "";
  const type = catalogTypeOf(raw["type"], seedFallback ? (base?.type ?? "Մշակութային") : "Մշակութային");
  const price = finiteNumber(raw["price"]);
  const seats = finiteNumber(raw["seatsLeft"] ?? raw["seats"]);
  const rating = finiteNumber(raw["rating"]);
  const reviews = finiteNumber(raw["reviews"]);
  const oldPrice = finiteNumber(raw["oldPrice"] ?? raw["old_price"]);
  const panorama = textOf(raw["panoramaUrl"] ?? raw["panorama_url"]);
  const virtualUrl = textOf(raw["virtual_tour_url"] ?? raw["virtualTourUrl"]).trim();
  const linkedRaw = raw["virtual_tour_id"];
  const linked =
    typeof linkedRaw === "string"
      ? linkedRaw.trim()
      : linkedRaw === null
        ? ""
        : seedFallback
          ? (base?.virtual_tour_id?.trim() ?? "")
          : "";
  const tour: CatalogTour = {
    id,
    title_hy: title.hy,
    title_en: title.en,
    title_ru: title.ru,
    description_hy: description.hy,
    description_en: description.en,
    description_ru: description.ru,
    location_hy: location.hy,
    location_en: location.en,
    location_ru: location.ru,
    image_url: image,
    category: typeof raw["category"] === "string" && raw["category"] ? raw["category"] : location.hy,
    type,
    departurePlace: textOf(raw["departurePlace"] ?? raw["departure_place"]) || (seedFallback ? (base?.departurePlace ?? "") : ""),
    departureTime: textOf(raw["departureTime"] ?? raw["departure_time"]) || (seedFallback ? (base?.departureTime ?? "08:30") : ""),
    returnTime: textOf(raw["returnTime"] ?? raw["return_time"]) || (seedFallback ? (base?.returnTime ?? "19:00") : ""),
    price: price ?? (seedFallback ? (base?.price ?? 0) : 0),
    seatsLeft: seats ?? (seedFallback ? (base?.seatsLeft ?? 0) : 0),
    rating: rating ?? (seedFallback ? (base?.rating ?? 5) : 5),
    reviews: reviews ?? (seedFallback ? (base?.reviews ?? 0) : 0),
    has360: typeof raw["has360"] === "boolean" ? raw["has360"] : seedFallback ? (base?.has360 ?? false) : false,
    hasAudioGuide:
      typeof raw["hasAudioGuide"] === "boolean" || typeof raw["has_audio_guide"] === "boolean"
        ? Boolean(raw["hasAudioGuide"] ?? raw["has_audio_guide"])
        : seedFallback
          ? (base?.hasAudioGuide ?? false)
          : false,
    day: weekendOf(raw["day"], seedFallback ? (base?.day ?? "saturday") : "saturday"),
    highlights: stringsOf(raw["highlights"], seedFallback ? (base?.highlights ?? []) : []),
    itinerary: Array.isArray(raw["itinerary"]) ? raw["itinerary"].filter(isStop) : seedFallback ? (base?.itinerary ?? []) : [],
    included: stringsOf(raw["included"], seedFallback ? (base?.included ?? []) : []),
    excluded: stringsOf(raw["excluded"], seedFallback ? (base?.excluded ?? []) : []),
    audioChapters: Array.isArray(raw["audio_chapters"] ?? raw["audioChapters"])
      ? ((raw["audio_chapters"] ?? raw["audioChapters"]) as unknown[]).flatMap((item) => {
          const chapter = readChapter(item);
          return chapter ? [chapter] : [];
        })
      : seedFallback
        ? (base?.audioChapters ?? [])
        : [],
    hotspots: Array.isArray(raw["hotspots"]) ? raw["hotspots"].filter(isHotspot) : seedFallback ? (base?.hotspots ?? []) : [],
    panoramaUrl: panorama,
    is_virtual_only: typeof raw["is_virtual_only"] === "boolean" ? raw["is_virtual_only"] : seedFallback ? base?.is_virtual_only === true : false,
    guideId:
      typeof raw["guideId"] === "string" || raw["guideId"] === null
        ? (raw["guideId"] as string | null)
        : typeof raw["guide_id"] === "string" || raw["guide_id"] === null
          ? (raw["guide_id"] as string | null)
          : null,
    driverId:
      typeof raw["driverId"] === "string" || raw["driverId"] === null
        ? (raw["driverId"] as string | null)
        : typeof raw["driver_id"] === "string" || raw["driver_id"] === null
          ? (raw["driver_id"] as string | null)
          : null,
  };
  if (oldPrice != null) tour.oldPrice = oldPrice;
  else if (seedFallback && base?.oldPrice !== undefined) tour.oldPrice = base.oldPrice;
  if (virtualUrl) tour.virtual_tour_url = virtualUrl;
  tour.virtual_tour_id = linked && linked !== tour.id ? linked : null;
  if (typeof raw["created_at"] === "string" && raw["created_at"]) tour.created_at = raw["created_at"];
  return tour;
}

export function deserializeTourCatalog(row: unknown): CatalogTour | null {
  return normalizeCatalogTour(row, false, null);
}

export function deserializeVirtualTour(row: unknown): CatalogTour | null {
  const raw = asRecord(row);
  if (!raw) return null;
  const titleHy = textOf(raw["title_hy"]) || textOf(raw["title"]);
  const descriptionHy = textOf(raw["description_hy"]) || textOf(raw["summary"]);
  const embed =
    textOf(raw["embed_url"]).trim() ||
    textOf(raw["panorama_url"]).trim() ||
    textOf(raw["virtual_tour_url"]).trim() ||
    textOf(raw["panoramaUrl"]).trim();
  const thumb = textOf(raw["thumbnail_url"]).trim() || textOf(raw["image_url"]).trim();
  return normalizeCatalogTour(
    {
      ...raw,
      title_hy: titleHy,
      description_hy: descriptionHy,
      location_hy: raw["location_hy"] ?? titleHy,
      location_en: raw["location_en"] ?? raw["title_en"],
      location_ru: raw["location_ru"] ?? raw["title_ru"],
      price: raw["price"] ?? 0,
      image_url: thumb,
      category: raw["category"] ?? titleHy,
      is_virtual_only: true,
      panoramaUrl: embed,
      panorama_url: embed,
      virtual_tour_url: embed,
      hotspots: raw["hotspots"],
      guideId: null,
      driverId: null,
    },
    false,
    null,
  );
}

export function mergeCatalogTours(physical: CatalogTour[], virtualRows: CatalogTour[]): CatalogTour[] {
  const byId = new Map<string, CatalogTour>();
  for (const tour of physical) {
    if (tour.is_virtual_only === true) continue;
    byId.set(tour.id, tour);
  }
  for (const virtualTour of virtualRows) {
    const existing = byId.get(virtualTour.id);
    if (existing) {
      const embed = virtualTour.virtual_tour_url || virtualTour.panoramaUrl;
      byId.set(virtualTour.id, {
        ...existing,
        has360: existing.has360 || Boolean(embed),
        panoramaUrl: existing.panoramaUrl || virtualTour.panoramaUrl,
        ...(embed ? { virtual_tour_url: existing.virtual_tour_url || embed } : {}),
      });
      continue;
    }
    byId.set(virtualTour.id, { ...virtualTour, is_virtual_only: true, virtual_tour_id: null });
  }
  for (const tour of physical) {
    if (tour.is_virtual_only === true && !byId.has(tour.id)) byId.set(tour.id, tour);
  }
  return [...byId.values()];
}

export function catalogAfterSave(current: CatalogTour[], saved: CatalogTour[]): CatalogTour[] {
  const next = current.filter((tour) => !saved.some((item) => item.id === tour.id));
  return [...next, ...saved];
}

export function remoteErrorParts(error: unknown): RemoteErrorParts {
  const row = asRecord(error);
  return {
    code: textOf(row?.["code"]).slice(0, 64),
    message: textOf(row?.["message"]).slice(0, 300),
    details: textOf(row?.["details"]).slice(0, 300),
  };
}

export function logRemoteError(action: string, error: unknown) {
  const parts = remoteErrorParts(error);
  console.error("[Արի Գնանք]", action, parts);
}

export function userFacingRemoteError(fallback: string, error?: unknown) {
  if (error instanceof Error && error.message && !error.message.includes("SQL") && !error.message.includes("select ")) {
    return error.message;
  }
  return fallback;
}

export function settingsFromMissingRow(fallback: SiteSettingsRecord) {
  return { ...fallback };
}

export { optionalText };
