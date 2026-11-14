import { useEffect, useRef, useState } from "react";
import { Camera, Keyboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ScannerStartSession,
  readScannerSurface,
  waitForScannerSurface,
} from "@/lib/qr-scanner-session";

type Props = {
  onScan: (value: string) => Promise<void> | void;
  disabled?: boolean;
};

function stopCapturedMedia(element: HTMLElement | null) {
  if (!element) return;
  for (const video of element.querySelectorAll("video")) {
    const stream = video.srcObject;
    if (stream instanceof MediaStream) {
      for (const track of stream.getTracks()) track.stop();
    }
    video.pause();
    video.srcObject = null;
    video.remove();
  }
}

async function releaseScanner(
  scanner: import("html5-qrcode").Html5Qrcode | null,
  element: HTMLElement | null,
) {
  if (scanner) {
    try {
      if (scanner.isScanning) await scanner.stop();
    } catch {
      /* Start can still be settling when the reader is closed. */
    }
    try {
      scanner.clear();
    } catch {
      /* The reader element was already removed. */
    }
  }
  stopCapturedMedia(element);
}

export function QrScanner({ onScan, disabled = false }: Props) {
  const readerRef = useRef<HTMLDivElement>(null);
  const scannerRef = useRef<import("html5-qrcode").Html5Qrcode | null>(null);
  const sessionRef = useRef(new ScannerStartSession());
  const onScanRef = useRef(onScan);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [manualCode, setManualCode] = useState("");
  const [busy, setBusy] = useState(false);
  onScanRef.current = onScan;

  const stopCamera = () => {
    sessionRef.current.invalidate();
    const scanner = scannerRef.current;
    scannerRef.current = null;
    setCameraOn(false);
    void releaseScanner(scanner, readerRef.current);
  };

  useEffect(() => {
    const session = sessionRef.current;
    // The reader element lives as long as this component, so the one seen now is the one to release.
    const reader = readerRef.current;
    return () => {
      session.invalidate();
      const scanner = scannerRef.current;
      scannerRef.current = null;
      void releaseScanner(scanner, reader);
    };
  }, []);

  const submit = async (value: string) => {
    const code = value.trim();
    if (!code || !sessionRef.current.tryAcceptScan()) return;
    setBusy(true);
    try {
      await onScanRef.current(code);
      setManualCode("");
    } finally {
      sessionRef.current.finishScan();
      setBusy(false);
    }
  };

  const startCamera = async () => {
    const session = sessionRef.current;
    const id = session.begin();
    setCameraError("");
    setCameraOn(true);
    const reader = readerRef.current;
    if (!reader) {
      if (session.isCurrent(id)) {
        setCameraOn(false);
        setCameraError("Տեսախցիկը չբացվեց։ Կարող եք մուտքագրել տոմսի կոդը։");
      }
      return;
    }
    try {
      await waitForScannerSurface(
        () => readScannerSurface(reader),
        () => !session.isCurrent(id),
        (check) => {
          const observer = new ResizeObserver(check);
          observer.observe(reader);
          const unsubscribe = session.subscribe(check);
          const frame = requestAnimationFrame(check);
          return () => {
            cancelAnimationFrame(frame);
            observer.disconnect();
            unsubscribe();
          };
        },
      );
      if (!session.isCurrent(id)) return;
      const { Html5Qrcode } = await import("html5-qrcode");
      if (!session.isCurrent(id)) return;
      const scanner = new Html5Qrcode(reader.id, {
        verbose: false,
        useBarCodeDetectorIfSupported: false,
      });
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: "environment" },
        { fps: 8 },
        (decodedText) => {
          if (!session.isCurrent(id) || !session.tryAcceptScan()) return;
          void releaseScanner(scanner, reader).then(() => {
            scannerRef.current = null;
            setCameraOn(false);
            void submitLocked(decodedText);
          });
        },
        () => undefined,
      );
      if (!session.isCurrent(id)) {
        scannerRef.current = null;
        await releaseScanner(scanner, reader);
      }
    } catch (error) {
      scannerRef.current = null;
      stopCapturedMedia(reader);
      if (!session.isCurrent(id) || (error instanceof DOMException && error.name === "AbortError"))
        return;
      setCameraOn(false);
      setCameraError("Տեսախցիկը չբացվեց։ Կարող եք մուտքագրել տոմսի կոդը։");
    }
  };

  const submitLocked = async (value: string) => {
    setBusy(true);
    try {
      await onScanRef.current(value.trim());
      setManualCode("");
    } finally {
      sessionRef.current.finishScan();
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-2xl bg-navy">
        <div
          id="guide-qr-reader"
          ref={readerRef}
          className={cameraOn ? "min-h-[240px]" : "hidden"}
        />
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
          <Button type="button" variant="outline" className="rounded-full" onClick={stopCamera}>
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
        <Button
          type="submit"
          variant="secondary"
          className="h-11 rounded-2xl"
          disabled={disabled || busy}
        >
          <Keyboard className="h-4 w-4" />
          Գրանցել
        </Button>
      </form>
    </div>
  );
}
