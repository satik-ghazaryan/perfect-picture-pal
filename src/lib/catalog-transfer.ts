import {
  deserializeTourCatalog,
  type CatalogTour,
  type SiteSettingsRecord,
} from "@/lib/tour-catalog-record";

export const CATALOG_BACKUP_VERSION = 1 as const;

export const TRANSFER_FIELDS = [
  "title",
  "description",
  "location",
  "price",
  "image",
  "type",
  "day",
  "departurePlace",
  "departureTime",
  "returnTime",
  "highlights",
  "itinerary",
  "included",
  "excluded",
  "audioChapters",
  "hotspots",
  "panorama",
  "virtualLink",
] as const;

export type TransferField = (typeof TRANSFER_FIELDS)[number];

export type CatalogBackup = {
  version: typeof CATALOG_BACKUP_VERSION;
  exportedAt: string;
  tours: CatalogTour[];
  settings: SiteSettingsRecord;
};

export type FieldDiff = {
  field: TransferField;
  local: string;
  remote: string;
  same: boolean;
};

export type TourTransferRow = {
  id: string;
  kind: "local-only" | "remote-only" | "both" | "type-conflict";
  title: string;
  diffs: FieldDiff[];
  summary?: string;
  conflictNote?: string;
};

export type TransferOperation =
  | { id: string; action: "update-fields"; fields: TransferField[] }
  | { id: string; action: "create" };

const FIELD_LABELS: Record<TransferField, string> = {
  title: "Վերնագիր",
  description: "Նկարագրություն",
  location: "Վայր",
  price: "Գին",
  image: "Նկար",
  type: "Տեսակ",
  day: "Օր",
  departurePlace: "Մեկնման վայր",
  departureTime: "Մեկնման ժամ",
  returnTime: "Վերադարձ",
  highlights: "Highlights",
  itinerary: "Ծրագիր",
  included: "Ներառված",
  excluded: "Չներառված",
  audioChapters: "Աուդիո",
  hotspots: "Hotspots",
  panorama: "Panorama",
  virtualLink: "Վիրտուալ կապ",
};

export function transferFieldLabel(field: TransferField) {
  return FIELD_LABELS[field];
}

function preview(value: unknown) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function fieldValue(tour: CatalogTour, field: TransferField): unknown {
  switch (field) {
    case "title":
      return { hy: tour.title_hy, en: tour.title_en, ru: tour.title_ru };
    case "description":
      return { hy: tour.description_hy, en: tour.description_en, ru: tour.description_ru };
    case "location":
      return { hy: tour.location_hy, en: tour.location_en, ru: tour.location_ru };
    case "price":
      return tour.price;
    case "image":
      return tour.image_url;
    case "type":
      return tour.type;
    case "day":
      return tour.day;
    case "departurePlace":
      return tour.departurePlace;
    case "departureTime":
      return tour.departureTime;
    case "returnTime":
      return tour.returnTime;
    case "highlights":
      return tour.highlights;
    case "itinerary":
      return tour.itinerary;
    case "included":
      return tour.included;
    case "excluded":
      return tour.excluded;
    case "audioChapters":
      return tour.audioChapters;
    case "hotspots":
      return tour.hotspots;
    case "panorama":
      return { panoramaUrl: tour.panoramaUrl, virtual_tour_url: tour.virtual_tour_url ?? "" };
    case "virtualLink":
      return tour.virtual_tour_id ?? "";
    default:
      return "";
  }
}

export function exportPublicCatalog(
  tours: CatalogTour[],
  settings: SiteSettingsRecord,
): CatalogBackup {
  return {
    version: CATALOG_BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    tours: tours.map((tour) => ({ ...tour, guideId: null, driverId: null })),
    settings: { ...settings },
  };
}

export function readLocalPublicCatalog(raw: string | null): CatalogBackup | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { tours?: unknown; settings?: unknown; users?: unknown };
    const result = parseCatalogBackup(
      JSON.stringify({
        version: CATALOG_BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        tours: parsed.tours,
        settings: parsed.settings,
      }),
    );
    return result.backup;
  } catch {
    return null;
  }
}

function asSettings(value: unknown): SiteSettingsRecord | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw["bannerTitle"] !== "string" || typeof raw["bannerText"] !== "string") return null;
  if (typeof raw["departurePlace"] !== "string") return null;
  const cashback = raw["cashbackPercent"];
  if (typeof cashback !== "number" || !Number.isFinite(cashback)) return null;
  return {
    bannerTitle: raw["bannerTitle"],
    bannerText: raw["bannerText"],
    departurePlace: raw["departurePlace"],
    cashbackPercent: cashback,
  };
}

export function parseCatalogBackup(text: string): {
  backup: CatalogBackup | null;
  warnings: string[];
} {
  const warnings: string[] = [];
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (parsed["users"] != null) warnings.push("users դաշտը անտեսվել է։");
    if (parsed["session"] != null || parsed["token"] != null)
      warnings.push("սեսիայի տվյալները անտեսվել են։");
    const settings = asSettings(parsed["settings"]);
    if (!settings) return { backup: null, warnings: [...warnings, "Կարգավորումները անվավեր են։"] };
    if (!Array.isArray(parsed["tours"]))
      return { backup: null, warnings: [...warnings, "Տուրերի ցանկը անվավեր է։"] };
    const tours: CatalogTour[] = [];
    for (const item of parsed["tours"]) {
      const tour = deserializeTourCatalog(item);
      if (!tour) continue;
      const raw = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      if (typeof raw["password"] === "string" && raw["password"])
        warnings.push("գաղտնաբառը չի տեղափոխվում։");
      tours.push({ ...tour, guideId: null, driverId: null });
    }
    if (tours.length === 0 && parsed["tours"].length > 0) {
      return { backup: null, warnings: [...warnings, "Տուրեր չհաջողվեց կարդալ։"] };
    }
    return {
      backup: {
        version: CATALOG_BACKUP_VERSION,
        exportedAt:
          typeof parsed["exportedAt"] === "string"
            ? parsed["exportedAt"]
            : new Date().toISOString(),
        tours,
        settings,
      },
      warnings,
    };
  } catch {
    return { backup: null, warnings: ["JSON ֆայլը անվավեր է։"] };
  }
}

export function compareCatalogTours(
  local: CatalogTour[],
  remote: CatalogTour[],
): TourTransferRow[] {
  const remoteById = new Map(remote.map((tour) => [tour.id, tour]));
  const localById = new Map(local.map((tour) => [tour.id, tour]));
  const ids = new Set([...localById.keys(), ...remoteById.keys()]);
  const rows: TourTransferRow[] = [];
  for (const id of ids) {
    const localTour = localById.get(id);
    const remoteTour = remoteById.get(id);
    if (localTour && !remoteTour) {
      rows.push({
        id,
        kind: "local-only",
        title: localTour.title_hy,
        diffs: [],
        summary: catalogTourSummary(localTour),
      });
      continue;
    }
    if (!localTour && remoteTour) {
      rows.push({
        id,
        kind: "remote-only",
        title: remoteTour.title_hy,
        diffs: [],
      });
      continue;
    }
    if (!localTour || !remoteTour) continue;
    if (Boolean(localTour.is_virtual_only) !== Boolean(remoteTour.is_virtual_only)) {
      rows.push({
        id,
        kind: "type-conflict",
        title: localTour.title_hy || remoteTour.title_hy,
        diffs: [],
        conflictNote:
          "Նույն ID-ով սովորական և վիրտուալ տուրերը չեն փոխարկվում։ Ընտրեք այլ ID կամ խմբագրեք առանձին։",
      });
      continue;
    }
    const diffs = TRANSFER_FIELDS.map((field) => {
      const localText = preview(fieldValue(localTour, field));
      const remoteText = preview(fieldValue(remoteTour, field));
      return { field, local: localText, remote: remoteText, same: localText === remoteText };
    });
    rows.push({ id, kind: "both", title: localTour.title_hy || remoteTour.title_hy, diffs });
  }
  return rows.sort((a, b) => a.id.localeCompare(b.id));
}

function catalogHas360(tour: CatalogTour) {
  return Boolean(
    tour.panoramaUrl.trim() ||
    (tour.virtual_tour_url ?? "").trim() ||
    (tour.virtual_tour_id ?? "").trim(),
  );
}

export function catalogTourSummary(tour: CatalogTour) {
  const dayLabel =
    tour.day === "sunday" ? "կիրակի" : tour.day === "saturday" ? "շաբաթ" : "օրը նշանակված չէ";
  return [
    tour.title_hy,
    tour.is_virtual_only === true ? "վիրտուալ" : `${tour.price} ֏`,
    dayLabel,
    `ծրագիր՝ ${tour.itinerary.length}`,
    `աուդիո՝ ${tour.audioChapters.length}`,
  ].join(" · ");
}

export function validateCatalogTourForCreate(tour: CatalogTour): string | null {
  if (tour.title_hy.trim().length < 2) return "Հայերեն վերնագիրը պարտադիր է։";
  if (!tour.image_url.trim()) return "Ավելացրեք նկարի հղում։";
  if (tour.is_virtual_only !== true) {
    if (!tour.departurePlace.trim()) return "Նշեք տուրի մեկնման վայրը։";
    if (!(tour.price > 0)) return "Գինը պետք է դրական թիվ լինի։";
  }
  return null;
}

export function createTourFromLocal(localTour: CatalogTour): CatalogTour {
  const message = validateCatalogTourForCreate(localTour);
  if (message) throw new Error(message);
  return { ...localTour, guideId: null, driverId: null };
}

export function mergeSelectedFields(
  remoteTour: CatalogTour,
  localTour: CatalogTour,
  fields: TransferField[],
): CatalogTour {
  const base: CatalogTour = { ...remoteTour };
  for (const field of fields) {
    switch (field) {
      case "title":
        base.title_hy = localTour.title_hy;
        base.title_en = localTour.title_en;
        base.title_ru = localTour.title_ru;
        break;
      case "description":
        base.description_hy = localTour.description_hy;
        base.description_en = localTour.description_en;
        base.description_ru = localTour.description_ru;
        break;
      case "location":
        base.location_hy = localTour.location_hy;
        base.location_en = localTour.location_en;
        base.location_ru = localTour.location_ru;
        base.category = localTour.category;
        break;
      case "price":
        base.price = localTour.price;
        break;
      case "image":
        base.image_url = localTour.image_url;
        break;
      case "type":
        base.type = localTour.type;
        break;
      case "day":
        base.day = localTour.day;
        break;
      case "departurePlace":
        base.departurePlace = localTour.departurePlace;
        break;
      case "departureTime":
        base.departureTime = localTour.departureTime;
        break;
      case "returnTime":
        base.returnTime = localTour.returnTime;
        break;
      case "highlights":
        base.highlights = [...localTour.highlights];
        break;
      case "itinerary":
        base.itinerary = [...localTour.itinerary];
        break;
      case "included":
        base.included = [...localTour.included];
        break;
      case "excluded":
        base.excluded = [...localTour.excluded];
        break;
      case "audioChapters":
        base.audioChapters = [...localTour.audioChapters];
        base.hasAudioGuide = base.audioChapters.length > 0;
        break;
      case "hotspots":
        base.hotspots = [...localTour.hotspots];
        break;
      case "panorama": {
        base.panoramaUrl = localTour.panoramaUrl;
        const embed = (localTour.virtual_tour_url ?? "").trim();
        if (embed) base.virtual_tour_url = embed;
        else delete base.virtual_tour_url;
        base.has360 = catalogHas360(base);
        break;
      }
      case "virtualLink":
        base.virtual_tour_id = localTour.virtual_tour_id ?? null;
        if (fields.includes("panorama")) base.has360 = catalogHas360(base);
        break;
      default:
        break;
    }
  }
  return base;
}

export function fieldPreview(tour: CatalogTour, field: TransferField) {
  return preview(fieldValue(tour, field));
}

export function staleTransferFields(
  fields: TransferField[],
  previousRemote: CatalogTour,
  currentRemote: CatalogTour,
): TransferField[] {
  return fields.filter(
    (field) => fieldPreview(previousRemote, field) !== fieldPreview(currentRemote, field),
  );
}

export async function applyTransferOperations(
  operations: TransferOperation[],
  context: {
    localById: Map<string, CatalogTour>;
    remoteById: Map<string, CatalogTour>;
    save: (tour: CatalogTour) => Promise<void>;
  },
): Promise<{
  saved: TransferOperation[];
  failed: { operation: TransferOperation; message: string }[];
}> {
  const saved: TransferOperation[] = [];
  const failed: { operation: TransferOperation; message: string }[] = [];
  for (const operation of operations) {
    try {
      const localTour = context.localById.get(operation.id);
      if (!localTour) throw new Error("Տեղային տուրը չկա։");
      if (operation.action === "create") {
        if (context.remoteById.has(operation.id)) {
          throw new Error("Հեռավար տուրն արդեն կա։ Ընտրեք դաշտերը, ոչ թե ամբողջ ստեղծումը։");
        }
        await context.save(createTourFromLocal(localTour));
      } else {
        if (!operation.fields.length) continue;
        const remoteTour = context.remoteById.get(operation.id);
        if (!remoteTour) throw new Error("Հեռավար տուրը չկա։ Ստեղծեք ամբողջ տուրը։");
        if (Boolean(remoteTour.is_virtual_only) !== Boolean(localTour.is_virtual_only)) {
          throw new Error("Նույն ID-ով սովորական և վիրտուալ տուրերը չեն փոխարկվում։");
        }
        await context.save(mergeSelectedFields(remoteTour, localTour, operation.fields));
      }
      saved.push(operation);
    } catch (error) {
      failed.push({
        operation,
        message: error instanceof Error ? error.message : "Չպահպանվեց։",
      });
    }
  }
  return { saved, failed };
}

export function remainingTransferOperations(
  operations: TransferOperation[],
  saved: TransferOperation[],
): TransferOperation[] {
  const done = new Set(saved.map((item) => `${item.action}:${item.id}`));
  return operations.filter((item) => !done.has(`${item.action}:${item.id}`));
}

export const TRANSFER_INSTRUCTIONS = [
  "Նախքան նոր կոդը բացելը այս դիտարկիչից արտահանեք տեղային կատալոգը։",
  "Այնուհետև կիրառեք SQL միգրացիան staging բազայում։",
  "Ներմուծեք JSON-ը, համեմատեք դաշտերը և կիրառեք միայն ընտրված տուրերը։",
  "Դատարկ հեռավար դաշտը ինքնաբերաբար չի համարվում բացակա տվյալ։",
  "Չընտրված տուրերն ու պահուստը մնում են անփոփոխ։",
].join(" ");
