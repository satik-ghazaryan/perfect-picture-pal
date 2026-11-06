import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CatalogStatusPanel } from "@/components/catalog-status-panel";
import {
  applyTransferOperations,
  compareCatalogTours,
  exportPublicCatalog,
  parseCatalogBackup,
  readLocalPublicCatalog,
  remainingTransferOperations,
  staleTransferFields,
  TRANSFER_INSTRUCTIONS,
  transferFieldLabel,
  validateCatalogTourForCreate,
  type CatalogBackup,
  type TransferField,
  type TransferOperation,
  type TourTransferRow,
} from "@/lib/catalog-transfer";
import {
  catalogIsPending,
  getAdminSnapshot,
  retryLiveCatalog,
  saveTour,
  type CatalogStatus,
  type ManagedTour,
} from "@/lib/admin";
import { isSupabaseConfigured } from "@/lib/supabase";

const STORAGE_KEY = "ari-gnank-catalog";

export function CatalogTransferPanel({
  remoteTours,
  catalogStatus,
  catalogError,
}: {
  remoteTours: ManagedTour[];
  catalogStatus: CatalogStatus;
  catalogError: string | null;
}) {
  const [backup, setBackup] = useState<CatalogBackup | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [rows, setRows] = useState<TourTransferRow[]>([]);
  const [selected, setSelected] = useState<Record<string, TransferField[]>>({});
  const [creates, setCreates] = useState<Record<string, boolean>>({});
  const [remoteSnapshot, setRemoteSnapshot] = useState(remoteTours);
  const [applying, setApplying] = useState(false);
  const [results, setResults] = useState<{
    saved: TransferOperation[];
    failed: { operation: TransferOperation; message: string }[];
    stale: { id: string; message: string }[];
  } | null>(null);

  const refreshRows = (localTours: ManagedTour[], nextRemote: ManagedTour[]) => {
    setRows(compareCatalogTours(localTours, nextRemote));
    setRemoteSnapshot(nextRemote);
  };

  useEffect(() => {
    if (!backup || catalogStatus !== "loaded") return;
    setRows(compareCatalogTours(backup.tours, remoteTours));
    setRemoteSnapshot(remoteTours);
  }, [backup, catalogStatus, remoteTours]);

  const exportCurrent = () => {
    const snapshot = getAdminSnapshot();
    const stored =
      typeof localStorage === "undefined"
        ? null
        : readLocalPublicCatalog(localStorage.getItem(STORAGE_KEY));
    const payload = stored ?? exportPublicCatalog(snapshot.tours, snapshot.settings);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "ari-gnank-catalog-backup.json";
    link.click();
    URL.revokeObjectURL(url);
    toast.success("Պահուստը ներբեռնվեց։ Users և գաղտնաբառեր չեն ներառված։");
  };

  const onFile = async (file: File | null) => {
    if (!file || applying) return;
    const text = await file.text();
    const parsed = parseCatalogBackup(text);
    setWarnings(parsed.warnings);
    setBackup(parsed.backup);
    setResults(null);
    setCreates({});
    setSelected({});
    if (!parsed.backup) {
      setRows([]);
      toast.error(parsed.warnings[0] ?? "Ֆայլը չկարդացվեց։");
      return;
    }
    refreshRows(parsed.backup.tours, getAdminSnapshot().tours);
  };

  const toggleField = (id: string, field: TransferField) => {
    if (applying) return;
    setSelected((current) => {
      const fields = current[id] ?? [];
      const next = fields.includes(field)
        ? fields.filter((item) => item !== field)
        : [...fields, field];
      return { ...current, [id]: next };
    });
  };

  const pendingOperations = (): TransferOperation[] => {
    const operations: TransferOperation[] = [];
    for (const [id, chosen] of Object.entries(creates)) {
      if (chosen) operations.push({ id, action: "create" });
    }
    for (const [id, fields] of Object.entries(selected)) {
      if (fields.length > 0) operations.push({ id, action: "update-fields", fields });
    }
    return operations;
  };

  const apply = async (operations = pendingOperations()) => {
    if (!backup || applying) return;
    if (catalogStatus !== "loaded") {
      toast.error("Կիրառումը հասանելի է միայն հաջող բեռնված կատալոգի դեպքում։");
      return;
    }
    setApplying(true);
    try {
      if (isSupabaseConfigured) {
        await retryLiveCatalog();
        const live = getAdminSnapshot();
        if (live.catalogStatus !== "loaded") {
          toast.error(live.catalogError || "Հեռավար կատալոգը չբեռնվեց։");
          return;
        }
      }
      const currentRemote = getAdminSnapshot().tours;
      const currentById = new Map(currentRemote.map((tour) => [tour.id, tour]));
      const previousById = new Map(remoteSnapshot.map((tour) => [tour.id, tour]));
      const ready: TransferOperation[] = [];
      const stale: { id: string; message: string }[] = [];
      for (const operation of operations) {
        if (operation.action !== "update-fields") {
          ready.push(operation);
          continue;
        }
        const previous = previousById.get(operation.id);
        const current = currentById.get(operation.id);
        if (!previous || !current) {
          stale.push({ id: operation.id, message: "Հեռավար տուրը փոխվել է։ Կրկին համեմատեք։" });
          continue;
        }
        const changed = staleTransferFields(operation.fields, previous, current);
        if (changed.length > 0) {
          stale.push({
            id: operation.id,
            message: `Հեռավար դաշտերը փոխվել են՝ ${changed.map((field) => transferFieldLabel(field)).join(", ")}։`,
          });
          continue;
        }
        ready.push(operation);
      }
      const outcome = await applyTransferOperations(ready, {
        localById: new Map(backup.tours.map((tour) => [tour.id, tour])),
        remoteById: currentById,
        save: async (tour) => {
          await saveTour(tour as ManagedTour);
        },
      });
      const leftover = remainingTransferOperations(ready, outcome.saved);
      const nextSelected: Record<string, TransferField[]> = {};
      const nextCreates: Record<string, boolean> = {};
      for (const operation of leftover) {
        if (operation.action === "create") nextCreates[operation.id] = true;
        else nextSelected[operation.id] = operation.fields;
      }
      for (const item of stale) {
        const operation = operations.find(
          (entry) => entry.id === item.id && entry.action === "update-fields",
        );
        if (operation && operation.action === "update-fields")
          nextSelected[item.id] = operation.fields;
      }
      setSelected(nextSelected);
      setCreates(nextCreates);
      const latest = getAdminSnapshot().tours;
      refreshRows(backup.tours, latest);
      setResults({ saved: outcome.saved, failed: outcome.failed, stale });
      if (outcome.failed.length === 0 && stale.length === 0 && outcome.saved.length > 0) {
        toast.success("Ընտրված գործողությունները պահվեցին։");
      } else if (outcome.failed.length > 0 || stale.length > 0) {
        toast.error("Մասնակի ձախողում կամ վերանայման կարիք։ Կարող եք կրկնել չպահվածները։");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Կիրառումը չհաջողվեց։");
    } finally {
      setApplying(false);
    }
  };

  const catalogReady = catalogStatus === "loaded";

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-black tracking-tight">Տեղային տեղափոխում</h1>
        <p className="mt-2 text-sm text-muted-foreground">{TRANSFER_INSTRUCTIONS}</p>
      </div>
      {(catalogIsPending(catalogStatus) || catalogStatus === "error") && (
        <CatalogStatusPanel
          status={catalogStatus}
          error={catalogError}
          onRetry={() => void retryLiveCatalog()}
        />
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          className="rounded-full font-bold"
          onClick={exportCurrent}
          disabled={applying}
        >
          Արտահանել պահուստ
        </Button>
        <label
          className={`inline-flex h-10 items-center rounded-full border border-border px-4 text-sm font-bold ${
            applying ? "pointer-events-none opacity-50" : "cursor-pointer"
          }`}
        >
          Ներմուծել JSON
          <input
            type="file"
            accept="application/json"
            className="sr-only"
            disabled={applying}
            onChange={(event) => void onFile(event.target.files?.[0] ?? null)}
          />
        </label>
      </div>
      {warnings.length > 0 && (
        <ul className="rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
      {rows.length > 0 && (
        <div className="space-y-3">
          {rows.map((row) => (
            <article key={row.id} className="rounded-3xl border border-border bg-card p-4">
              <h2 className="font-bold">
                {row.title || row.id}{" "}
                <span className="text-xs font-medium text-muted-foreground">
                  {row.kind === "local-only"
                    ? "միայն տեղային"
                    : row.kind === "remote-only"
                      ? "միայն հեռավար"
                      : row.kind === "type-conflict"
                        ? "տեսակի կոնֆլիկտ"
                        : "երկուսում էլ"}
                </span>
              </h2>
              {row.kind === "remote-only" && (
                <p className="mt-2 text-sm text-muted-foreground">
                  Հեռավար գրառումը չի վերագրվում առանց տեղային պատճենի։
                </p>
              )}
              {row.kind === "type-conflict" && (
                <p className="mt-2 text-sm text-destructive">{row.conflictNote}</p>
              )}
              {row.kind === "local-only" && backup && (
                <div className="mt-3 space-y-2 text-sm">
                  <p className="rounded-2xl bg-muted px-3 py-2">{row.summary}</p>
                  {(() => {
                    const localTour = backup.tours.find((tour) => tour.id === row.id);
                    const invalid = localTour
                      ? validateCatalogTourForCreate(localTour)
                      : "Տուրը չկա։";
                    return invalid ? <p className="text-destructive">{invalid}</p> : null;
                  })()}
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      disabled={applying || !catalogReady}
                      checked={Boolean(creates[row.id])}
                      onChange={(event) =>
                        setCreates((current) => ({ ...current, [row.id]: event.target.checked }))
                      }
                    />
                    Ստեղծել ամբողջ տուրը
                  </label>
                </div>
              )}
              {row.kind === "both" && (
                <ul className="mt-3 space-y-2 text-sm">
                  {row.diffs
                    .filter((diff) => !diff.same)
                    .map((diff) => (
                      <li key={diff.field} className="rounded-2xl bg-muted px-3 py-2">
                        <label className="flex items-start gap-2">
                          <input
                            type="checkbox"
                            disabled={applying || !catalogReady}
                            checked={(selected[row.id] ?? []).includes(diff.field)}
                            onChange={() => toggleField(row.id, diff.field)}
                          />
                          <span>
                            <span className="font-semibold">{transferFieldLabel(diff.field)}</span>
                            <span className="mt-1 block text-xs text-muted-foreground">
                              Տեղային՝ {diff.local || "∅"}
                            </span>
                            <span className="block text-xs text-muted-foreground">
                              Հեռավար՝ {diff.remote || "∅"}
                            </span>
                          </span>
                        </label>
                      </li>
                    ))}
                  {row.diffs.every((diff) => diff.same) && (
                    <li className="text-muted-foreground">Տարբերություն չկա։</li>
                  )}
                </ul>
              )}
            </article>
          ))}
          <Button
            type="button"
            className="rounded-full font-bold"
            disabled={applying || !catalogReady || pendingOperations().length === 0}
            onClick={() => void apply()}
          >
            {applying ? "Պահվում է" : "Կիրառել ընտրված գործողությունները"}
          </Button>
        </div>
      )}
      {results && (
        <div className="rounded-2xl border border-border px-4 py-3 text-sm">
          <p>Պահվեց՝ {results.saved.length}</p>
          {results.saved.map((item) => (
            <p key={`saved-${item.action}-${item.id}`} className="text-muted-foreground">
              {item.id}: {item.action === "create" ? "ստեղծվեց" : "դաշտերը պահվեցին"}
            </p>
          ))}
          {results.failed.length > 0 && (
            <ul className="mt-2 text-destructive">
              {results.failed.map((item) => (
                <li key={`failed-${item.operation.action}-${item.operation.id}`}>
                  {item.operation.id}: {item.message}
                </li>
              ))}
            </ul>
          )}
          {results.stale.length > 0 && (
            <ul className="mt-2 text-amber-700">
              {results.stale.map((item) => (
                <li key={`stale-${item.id}`}>
                  {item.id}: {item.message}
                </li>
              ))}
            </ul>
          )}
          {(results.failed.length > 0 || results.stale.length > 0) && (
            <Button
              type="button"
              variant="outline"
              className="mt-3 rounded-full font-bold"
              disabled={applying || !catalogReady || pendingOperations().length === 0}
              onClick={() => void apply()}
            >
              Կրկնել չպահվածները
            </Button>
          )}
        </div>
      )}
      {!backup && (
        <p className="text-sm text-muted-foreground">
          Այս գործիքը չի գործարկում իրական տվյալներ ինքնաբերաբար։ Նախ արտահանեք, ապա ներմուծեք և
          ընտրեք գործողությունները։
        </p>
      )}
    </section>
  );
}
