import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { readGuestClaims, rememberGuestBooking } from "@/lib/guest-claims";

class MemoryStorage {
  private items = new Map<string, string>();
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
}

describe("guest booking claims kept on this device", () => {
  beforeEach(() => {
    (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();
  });

  it("keeps valid bookings once and drops old or malformed ones", () => {
    const now = 1_800_000_000_000;
    rememberGuestBooking("key-aaaaaaaaaaaaaaaa", "proof-aaaaaaaaaaaaaa", now);
    rememberGuestBooking("key-aaaaaaaaaaaaaaaa", "proof-aaaaaaaaaaaaaa", now + 1);
    rememberGuestBooking("short", "proof-bbbbbbbbbbbbbb", now);
    rememberGuestBooking("key-cccccccccccccccc", "not valid!", now);
    assert.deepEqual(readGuestClaims(now + 2), [
      { key: "key-aaaaaaaaaaaaaaaa", proof: "proof-aaaaaaaaaaaaaa", at: now + 1 },
    ]);
    assert.deepEqual(readGuestClaims(now + 121 * 24 * 60 * 60 * 1000), []);
  });

  it("ignores broken stored data", () => {
    localStorage.setItem("ari-gnank-guest-bookings", "{not json");
    assert.deepEqual(readGuestClaims(), []);
  });
});
