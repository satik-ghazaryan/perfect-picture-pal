import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  compareCatalogTours,
  exportPublicCatalog,
  mergeSelectedFields,
  parseCatalogBackup,
  readLocalPublicCatalog,
  TRANSFER_INSTRUCTIONS,
  transferFieldLabel,
  type CatalogBackup,
  type TransferField,
  type TourTransferRow,
} from "@/lib/catalog-transfer";
import { getAdminSnapshot, saveTour, type ManagedTour } from "@/lib/admin";

const STORAGE_KEY = "ari-gnank-catalog";

export function CatalogTransferPanel({ remoteTours }: { remoteTours: ManagedTour[] }) {
  const [backup, setBackup] = useState<CatalogBackup | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [rows, setRows] = useState<TourTransferRow[]>([]);
  const [selected, setSelected] = useState<Record<string, TransferField[]>>({});
  const [applying, setApplying] = useState(false);
  const [results, setResults] = useState<{
    saved: string[];
    failed: { id: string; message: string }[];
  } | null>(null);

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
    if (!file) return;
    const text = await file.text();
    const parsed = parseCatalogBackup(text);
    setWarnings(parsed.warnings);
    setBackup(parsed.backup);
    setResults(null);
    if (!parsed.backup) {
      setRows([]);
      toast.error(parsed.warnings[0] ?? "Ֆայլը չկարդացվեց։");
      return;
    }
    setRows(compareCatalogTours(parsed.backup.tours, remoteTours));
    setSelected({});
  };

  const toggleField = (id: string, field: TransferField) => {
    setSelected((current) => {
      const fields = current[id] ?? [];
      const next = fields.includes(field)
        ? fields.filter((item) => item !== field)
        : [...fields, field];
      return { ...current, [id]: next };
    });
  };

  const apply = async () => {
    if (!backup) return;
    setApplying(true);
    const saved: string[] = [];
    const failed: { id: string; message: string }[] = [];
    const localById = new Map(backup.tours.map((tour) => [tour.id, tour]));
    const remoteById = new Map(remoteTours.map((tour) => [tour.id, tour]));
    for (const [id, fields] of Object.entries(selected)) {
      if (!fields.length) continue;
      const localTour = localById.get(id);
      if (!localTour) continue;
      const merged = mergeSelectedFields(remoteById.get(id) ?? null, localTour, fields);
      try {
        await saveTour(merged as ManagedTour);
        saved.push(id);
      } catch (error) {
        failed.push({ id, message: error instanceof Error ? error.message : "Չպահպանվեց։" });
      }
    }
    setResults({ saved, failed });
    setApplying(false);
    if (failed.length === 0 && saved.length > 0) toast.success("Ընտրված դաշտերը պահվեցին։");
    else if (failed.length > 0) toast.error("Մասնակի ձախողում։ Կարող եք կրկնել չպահված տուրերը։");
  };

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-black tracking-tight">Տեղային տեղափոխում</h1>
        <p className="mt-2 text-sm text-muted-foreground">{TRANSFER_INSTRUCTIONS}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" className="rounded-full font-bold" onClick={exportCurrent}>
          Արտահանել պահուստ
        </Button>
        <label className="inline-flex h-10 cursor-pointer items-center rounded-full border border-border px-4 text-sm font-bold">
          Ներմուծել JSON
          <input
            type="file"
            accept="application/json"
            className="sr-only"
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
                      : "երկուսում էլ"}
                </span>
              </h2>
              {row.kind === "remote-only" ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  Հեռավար գրառումը չի վերագրվում առանց տեղային պատճենի։
                </p>
              ) : (
                <ul className="mt-3 space-y-2 text-sm">
                  {row.diffs
                    .filter((diff) => !diff.same)
                    .map((diff) => (
                      <li key={diff.field} className="rounded-2xl bg-muted px-3 py-2">
                        <label className="flex items-start gap-2">
                          <input
                            type="checkbox"
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
            disabled={applying}
            onClick={() => void apply()}
          >
            {applying ? "Պահվում է" : "Կիրառել ընտրված դաշտերը"}
          </Button>
        </div>
      )}
      {results && (
        <div className="rounded-2xl border border-border px-4 py-3 text-sm">
          <p>Պահվեց՝ {results.saved.length}</p>
          {results.failed.length > 0 && (
            <ul className="mt-2 text-destructive">
              {results.failed.map((item) => (
                <li key={item.id}>
                  {item.id}: {item.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {!backup && (
        <p className="text-sm text-muted-foreground">
          Այս գործիքը չի գործարկում իրական տվյալներ ինքնաբերաբար։ Նախ արտահանեք, ապա ներմուծեք և
          ընտրեք դաշտերը։
        </p>
      )}
    </section>
  );
}
