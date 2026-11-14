import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/** The ticket code as a QR image, the same code the guide scans at boarding. */
export function TicketQr({ value, className }: { value: string; className?: string }) {
  const [src, setSrc] = useState("");

  useEffect(() => {
    let cancelled = false;
    void import("qrcode").then((QR) =>
      QR.toDataURL(value, { margin: 1, width: 256, errorCorrectionLevel: "M" }).then((url) => {
        if (!cancelled) setSrc(url);
      }),
    );
    return () => {
      cancelled = true;
    };
  }, [value]);

  return (
    <span
      className={cn(
        "grid h-24 w-24 shrink-0 place-items-center rounded-xl bg-white p-1",
        className,
      )}
    >
      {src ? (
        <img src={src} alt={`QR ${value}`} className="h-full w-full" />
      ) : (
        <span className="h-full w-full" />
      )}
    </span>
  );
}
