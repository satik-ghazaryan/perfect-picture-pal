import { useEffect, useRef, useState } from "react";
import { Camera, Keyboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Props = {
  onScan: (value: string) => Promise<void> | void;
  disabled?: boolean;
};

export function QrScanner({ onScan, disabled = false }: Props) {
  const scannerRef = useRef<import("html5-qrcode").Html5Qrcode | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [manualCode, setManualCode] = useState("");
  const [busy, setBusy] = useState(false);

  const stopCamera = async () => {
    const scanner = scannerRef.current;
    scannerRef.current = null;
    if (!scanner) return;
    try {
      if (scanner.isScanning) await scanner.stop();
      scanner.clear();
    } catch {
      /* The camera element is already gone. */
    }
    setCameraOn(false);
  };

  useEffect(() => {
    return () => {
      void stopCamera();
    };
  }, []);

  const startCamera = async () => {
    setCameraError("");
    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      const scanner = new Html5Qrcode("guide-qr-reader");
      scannerRef.current = scanner;
      setCameraOn(true);
      await scanner.start(
        { facingMode: "environment" },
        { fps: 8, qrbox: { width: 220, height: 220 } },
        (decodedText) => {
          void stopCamera().then(() => submit(decodedText));
        },
        () => undefined,
      );
    } catch {
      setCameraOn(false);
      setCameraError("Տեսախցիկը չբացվեց։ Կարող եք մուտքագրել տոմսի կոդը։");
    }
  };

  const submit = async (value: string) => {
    const code = value.trim();
    if (!code || busy) return;
    setBusy(true);
    try {
      await onScan(code);
      setManualCode("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-2xl bg-navy">
        <div id="guide-qr-reader" className={cameraOn ? "min-h-[240px]" : "hidden"} />
        {!cameraOn && (
          <div className="grid min-h-[240px] place-items-center px-4 text-center text-navy-foreground">
            <div>
              <Camera className="mx-auto h-8 w-8 text-accent" />
              <p className="mt-2 text-sm font-bold">QR սկաներ</p>
              <p className="mt-1 text-xs text-navy-foreground/70">
                Բացեք տեսախցիկը և ուղղեք այն տոմսի կոդին։
              </p>
            </div>
          </div>
        )}
      </div>
      {cameraError && <p className="text-xs font-medium text-destructive">{cameraError}</p>}
      <div className="flex flex-wrap gap-2">
        {cameraOn ? (
          <Button type="button" variant="outline" className="rounded-full" onClick={() => void stopCamera()}>
            Կանգնեցնել տեսախցիկը
          </Button>
        ) : (
          <Button
            type="button"
            className="rounded-full font-bold"
            disabled={disabled || busy}
            onClick={() => void startCamera()}
          >
            <Camera className="h-4 w-4" />
            Բացել տեսախցիկը
          </Button>
        )}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(manualCode);
        }}
      >
        <Input
          value={manualCode}
          onChange={(event) => setManualCode(event.target.value)}
          placeholder="AG-GAR-100001"
          aria-label="Տոմսի կոդ"
          className="h-11 rounded-2xl font-mono"
          disabled={disabled || busy}
        />
        <Button type="submit" variant="secondary" className="h-11 rounded-2xl" disabled={disabled || busy}>
          <Keyboard className="h-4 w-4" />
          Գրանցել
        </Button>
      </form>
    </div>
  );
}
