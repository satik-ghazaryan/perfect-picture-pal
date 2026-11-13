import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ScannerStartSession,
  scannerSurfaceReady,
  waitForScannerSurface,
  type ScannerSurface,
} from "./qr-scanner-session";

const hidden: ScannerSurface = { isConnected: true, clientWidth: 0, clientHeight: 0, hidden: true };
const ready: ScannerSurface = {
  isConnected: true,
  clientWidth: 320,
  clientHeight: 240,
  hidden: false,
};

describe("scanner surface", () => {
  it("waits until the reader is mounted, visible, and has a positive size", () => {
    assert.equal(scannerSurfaceReady(null), false);
    assert.equal(scannerSurfaceReady({ ...ready, isConnected: false }), false);
    assert.equal(scannerSurfaceReady(hidden), false);
    assert.equal(scannerSurfaceReady({ ...ready, clientWidth: 0 }), false);
    assert.equal(scannerSurfaceReady({ ...ready, clientHeight: 0 }), false);
    assert.equal(scannerSurfaceReady(ready), true);
  });

  it("starts only after the surface reports a positive box and stops when cancelled", async () => {
    const surface = { ...hidden };
    let notify: () => void = () => undefined;
    const pending = waitForScannerSurface(
      () => surface,
      () => false,
      (check) => {
        notify = check;
        return () => undefined;
      },
    );
    let resolved = false;
    const done = pending.then(() => {
      resolved = true;
    });
    notify();
    await Promise.resolve();
    assert.equal(resolved, false);
    surface.hidden = false;
    surface.clientWidth = 280;
    surface.clientHeight = 240;
    notify();
    await done;
    assert.equal(resolved, true);

    let cancelled = false;
    await assert.rejects(
      waitForScannerSurface(
        () => hidden,
        () => cancelled,
        (check) => {
          queueMicrotask(() => {
            cancelled = true;
            check();
          });
          return () => undefined;
        },
      ),
      (error: unknown) => error instanceof DOMException && error.name === "AbortError",
    );
  });
});

describe("scanner start session", () => {
  it("cancels a start that is still in progress and ignores a repeated read", () => {
    const session = new ScannerStartSession();
    const first = session.begin();
    assert.equal(session.isCurrent(first), true);
    session.invalidate();
    assert.equal(session.isCurrent(first), false);
    const second = session.begin();
    assert.equal(session.isCurrent(first), false);
    assert.equal(session.isCurrent(second), true);
    assert.equal(session.tryAcceptScan(), true);
    assert.equal(session.tryAcceptScan(), false);
    session.finishScan();
    assert.equal(session.tryAcceptScan(), true);
  });
});
