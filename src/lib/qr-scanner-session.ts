export type ScannerSurface = {
  isConnected: boolean;
  clientWidth: number;
  clientHeight: number;
  hidden: boolean;
};

export function scannerSurfaceReady(element: ScannerSurface | null): boolean {
  return Boolean(
    element &&
    element.isConnected &&
    !element.hidden &&
    element.clientWidth > 0 &&
    element.clientHeight > 0,
  );
}

export function readScannerSurface(element: HTMLElement): ScannerSurface {
  const style = getComputedStyle(element);
  return {
    isConnected: element.isConnected,
    clientWidth: element.clientWidth,
    clientHeight: element.clientHeight,
    hidden: style.display === "none" || style.visibility === "hidden",
  };
}

export function waitForScannerSurface(
  read: () => ScannerSurface,
  isCancelled: () => boolean,
  observe: (check: () => void) => () => void,
): Promise<void> {
  if (isCancelled()) return Promise.reject(scannerStartAborted());
  if (scannerSurfaceReady(read())) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    let stop: () => void = () => undefined;
    const check = () => {
      if (settled) return;
      if (isCancelled()) {
        settled = true;
        stop();
        reject(scannerStartAborted());
        return;
      }
      if (scannerSurfaceReady(read())) {
        settled = true;
        stop();
        resolve();
      }
    };
    stop = observe(check);
    check();
  });
}

export function scannerStartAborted(): DOMException {
  return new DOMException("The scanner start was cancelled.", "AbortError");
}

export class ScannerStartSession {
  private generation = 0;
  private scanInFlight = false;
  private readonly listeners = new Set<() => void>();

  begin(): number {
    this.generation += 1;
    return this.generation;
  }

  invalidate(): void {
    this.generation += 1;
    for (const listener of this.listeners) listener();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  isCurrent(id: number): boolean {
    return id === this.generation;
  }

  tryAcceptScan(): boolean {
    if (this.scanInFlight) return false;
    this.scanInFlight = true;
    return true;
  }

  finishScan(): void {
    this.scanInFlight = false;
  }
}
