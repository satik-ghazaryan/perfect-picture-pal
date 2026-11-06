import { Button } from "@/components/ui/button";
import { catalogIsPending, type CatalogStatus } from "@/lib/admin";

export function CatalogStatusPanel({
  status,
  error,
  onRetry,
}: {
  status: CatalogStatus;
  error: string | null;
  onRetry: () => void;
}) {
  if (catalogIsPending(status)) {
    return <p className="px-4 py-16 text-center text-sm text-muted-foreground">Բեռնվում է...</p>;
  }
  if (status === "error") {
    return (
      <div className="mx-auto max-w-lg space-y-3 px-4 py-16 text-center">
        <p className="text-sm text-destructive">{error || "Կատալոգը չբեռնվեց։"}</p>
        <Button type="button" className="rounded-full font-bold" onClick={onRetry}>
          Կրկին փորձել
        </Button>
      </div>
    );
  }
  return null;
}
