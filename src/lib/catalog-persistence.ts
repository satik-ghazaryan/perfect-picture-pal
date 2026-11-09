import { withPublishedGarniAudio } from "@/lib/garni-audio";
import {
  deserializeSiteSettings,
  deserializeTourCatalog,
  deserializeVirtualTour,
  logRemoteError,
  mergeCatalogTours,
  serializeSiteSettings,
  serializeTourCatalog,
  serializeVirtualTour,
  type CatalogTour,
  type SiteSettingsRecord,
} from "@/lib/tour-catalog-record";

export type RemoteError = { code?: string; message: string; details?: string } | null;

export type RemoteResult<T> = { data: T; error: RemoteError };

export type CatalogRemote = {
  loadTours(): Promise<RemoteResult<Record<string, unknown>[]>>;
  loadVirtualTours(): Promise<RemoteResult<Record<string, unknown>[]>>;
  loadDepartures(): Promise<
    RemoteResult<
      {
        tour_id: string;
        available_seats: number;
        guide_id: string | null;
        driver_id: string | null;
      }[]
    >
  >;
  loadSettings(): Promise<RemoteResult<Record<string, unknown> | null>>;
  upsertTour(row: Record<string, unknown>): Promise<RemoteResult<null>>;
  upsertVirtual(row: Record<string, unknown>): Promise<RemoteResult<null>>;
  upsertSettings(row: Record<string, unknown>): Promise<RemoteResult<null>>;
  deleteTour(id: string): Promise<RemoteResult<null>>;
  deleteVirtual(id: string): Promise<RemoteResult<null>>;
};

export type CatalogLoadSuccess = {
  status: "loaded";
  tours: CatalogTour[];
  settings: SiteSettingsRecord;
  settingsError: string | null;
};

export type CatalogLoadFailure = {
  status: "error";
  message: string;
};

export type CatalogLoadOutcome = CatalogLoadSuccess | CatalogLoadFailure;

function fail(action: string, fallback: string, error: RemoteError): CatalogLoadFailure {
  logRemoteError(action, error ?? { message: fallback });
  return { status: "error", message: fallback };
}

export async function loadRemoteCatalog(
  remote: CatalogRemote,
  fallbackSettings: SiteSettingsRecord,
): Promise<CatalogLoadOutcome> {
  const [toursResult, virtualResult, departuresResult, settingsResult] = await Promise.all([
    remote.loadTours(),
    remote.loadVirtualTours(),
    remote.loadDepartures(),
    remote.loadSettings(),
  ]);
  if (toursResult.error) {
    return fail(
      "tours.select",
      "Տուրերը չբեռնվեցին Supabase-ից։ Ցանկը չի փոխարինվել տեղային օրինակով։",
      toursResult.error,
    );
  }
  if (virtualResult.error) {
    return fail(
      "virtual_tours.select",
      "Վիրտուալ տուրերը չբեռնվեցին Supabase-ից։ Ցանկը ամբողջությամբ չթարմացվեց։",
      virtualResult.error,
    );
  }
  const physical = toursResult.data
    .map((row) => deserializeTourCatalog(row))
    .filter((tour): tour is CatalogTour => tour !== null)
    .map((tour) => withPublishedGarniAudio(tour));
  const virtualTours = virtualResult.data
    .map((row) => deserializeVirtualTour(row))
    .filter((tour): tour is CatalogTour => tour !== null);
  let tours = mergeCatalogTours(physical, virtualTours);
  if (!departuresResult.error && departuresResult.data.length > 0) {
    const latest = new Map<
      (typeof departuresResult.data)[number]["tour_id"],
      (typeof departuresResult.data)[number]
    >();
    for (const row of departuresResult.data) latest.set(row.tour_id, row);
    tours = tours.map((tour) => {
      const assigned = latest.get(tour.id);
      if (!assigned) return tour;
      return {
        ...tour,
        seatsLeft: assigned.available_seats,
        guideId: assigned.guide_id,
        driverId: assigned.driver_id,
      };
    });
  }
  let settings = fallbackSettings;
  let settingsError: string | null = null;
  if (settingsResult.error) {
    logRemoteError("site_settings.select", settingsResult.error);
    settingsError = "Կայքի կարգավորումները չբեռնվեցին Supabase-ից։";
  } else if (settingsResult.data) {
    settings = deserializeSiteSettings(settingsResult.data, fallbackSettings) ?? fallbackSettings;
  }
  return { status: "loaded", tours, settings, settingsError };
}

export async function persistCatalogTour(remote: CatalogRemote, tour: CatalogTour): Promise<void> {
  if (tour.is_virtual_only === true) {
    const { error } = await remote.upsertVirtual(
      serializeVirtualTour(tour) as unknown as Record<string, unknown>,
    );
    if (error) {
      logRemoteError("virtual_tours.upsert", error);
      throw new Error("Վիրտուալ տուրը Supabase-ում չպահպանվեց։");
    }
    return;
  }
  const { error } = await remote.upsertTour(
    serializeTourCatalog(tour) as unknown as Record<string, unknown>,
  );
  if (error) {
    logRemoteError("tours.upsert", error);
    throw new Error("Տուրը Supabase-ում չպահպանվեց։");
  }
}

export async function persistCatalogSettings(
  remote: CatalogRemote,
  settings: SiteSettingsRecord,
): Promise<void> {
  const { error } = await remote.upsertSettings(
    serializeSiteSettings(settings) as unknown as Record<string, unknown>,
  );
  if (error) {
    logRemoteError("site_settings.upsert", error);
    throw new Error("Կարգավորումները Supabase-ում չպահպանվեցին։");
  }
}

export async function removeCatalogTour(remote: CatalogRemote, tour: CatalogTour): Promise<void> {
  if (tour.is_virtual_only === true) {
    const { error } = await remote.deleteVirtual(tour.id);
    if (error) {
      logRemoteError("virtual_tours.delete", error);
      throw new Error("Վիրտուալ տուրը Supabase-ից չջնջվեց։");
    }
    return;
  }
  const { error } = await remote.deleteTour(tour.id);
  if (error) {
    logRemoteError("tours.delete", error);
    throw new Error("Տուրը Supabase-ից չջնջվեց։");
  }
}

type MemoryTables = {
  tours: Record<string, unknown>[];
  virtual: Record<string, unknown>[];
  settings: Record<string, unknown> | null;
  failTourUpsert?: boolean;
  failUpsertIds?: string[];
  failLoad?: boolean;
};

type QueryClient = {
  from: (table: string) => {
    select: (columns: string) => {
      order: (column: string) => Promise<{ data: unknown[] | null; error: RemoteError }>;
      eq: (
        column: string,
        value: string | number,
      ) => {
        maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: RemoteError }>;
      };
    };
    upsert: (row: Record<string, unknown>) => Promise<{ error: RemoteError }>;
    delete: () => { eq: (column: string, value: string) => Promise<{ error: RemoteError }> };
  };
};

export function createSupabaseCatalogRemote(client: QueryClient): CatalogRemote {
  return {
    async loadTours() {
      const { data, error } = await client.from("tours").select("*").order("id");
      return { data: (data ?? []) as Record<string, unknown>[], error };
    },
    async loadVirtualTours() {
      const { data, error } = await client.from("virtual_tours").select("*").order("id");
      return { data: (data ?? []) as Record<string, unknown>[], error };
    },
    async loadDepartures() {
      const { data, error } = await client
        .from("departures")
        .select("tour_id, available_seats, guide_id, driver_id, departure_date")
        .order("departure_date");
      return {
        data: (data ?? []) as {
          tour_id: string;
          available_seats: number;
          guide_id: string | null;
          driver_id: string | null;
        }[],
        error,
      };
    },
    async loadSettings() {
      const { data, error } = await client
        .from("site_settings")
        .select("id, banner_title, banner_text, departure_place, cashback_percent")
        .eq("id", 1)
        .maybeSingle();
      return { data, error };
    },
    async upsertTour(row) {
      const { error } = await client.from("tours").upsert(row);
      return { data: null, error };
    },
    async upsertVirtual(row) {
      const { error } = await client.from("virtual_tours").upsert(row);
      return { data: null, error };
    },
    async upsertSettings(row) {
      const { error } = await client.from("site_settings").upsert(row);
      return { data: null, error };
    },
    async deleteTour(id) {
      const { error } = await client.from("tours").delete().eq("id", id);
      return { data: null, error };
    },
    async deleteVirtual(id) {
      const { error } = await client.from("virtual_tours").delete().eq("id", id);
      return { data: null, error };
    },
  };
}

export function createMemoryCatalogRemote(
  seed: Partial<MemoryTables> = {},
): CatalogRemote & { store: MemoryTables } {
  const store: MemoryTables = {
    tours: seed.tours ? [...seed.tours] : [],
    virtual: seed.virtual ? [...seed.virtual] : [],
    settings: seed.settings ?? null,
    failTourUpsert: seed.failTourUpsert ?? false,
    failUpsertIds: seed.failUpsertIds ? [...seed.failUpsertIds] : [],
    failLoad: seed.failLoad ?? false,
  };
  const ok = <T>(data: T): RemoteResult<T> => ({ data, error: null });
  const err = (message: string): RemoteResult<never> => ({
    data: null as never,
    error: { code: "TEST", message, details: "" },
  });
  return {
    store,
    async loadTours() {
      if (store.failLoad) return err("load failed");
      return ok(store.tours);
    },
    async loadVirtualTours() {
      if (store.failLoad) return err("load failed");
      return ok(store.virtual);
    },
    async loadDepartures() {
      return ok([]);
    },
    async loadSettings() {
      return ok(store.settings);
    },
    async upsertTour(row) {
      const id = String(row["id"]);
      if (store.failTourUpsert || store.failUpsertIds?.includes(id)) return err("upsert failed");
      store.tours = [...store.tours.filter((item) => item["id"] !== id), row];
      return ok(null);
    },
    async upsertVirtual(row) {
      const id = String(row["id"]);
      store.virtual = [...store.virtual.filter((item) => item["id"] !== id), row];
      return ok(null);
    },
    async upsertSettings(row) {
      store.settings = row;
      return ok(null);
    },
    async deleteTour(id) {
      store.tours = store.tours.filter((item) => item["id"] !== id);
      return ok(null);
    },
    async deleteVirtual(id) {
      store.virtual = store.virtual.filter((item) => item["id"] !== id);
      return ok(null);
    },
  };
}
