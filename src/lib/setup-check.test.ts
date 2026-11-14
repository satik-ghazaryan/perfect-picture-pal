import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setupStatus } from "@/lib/setup-check.server";

describe("website setup status", () => {
  it("is ok when every group has one of its settings", () => {
    const status = setupStatus({
      VITE_SUPABASE_URL: "https://x.supabase.co",
      SUPABASE_ANON_KEY: "anon",
      SUPABASE_SERVICE_ROLE_KEY: "secret-value",
      PYTHON_BACKEND_URL: "https://api",
      CHAT_INTENT_API_SECRET: "a",
      IDEAS_API_SECRET: "b",
    });
    assert.equal(status.ok, true);
  });

  it("names the missing group without exposing values", () => {
    const status = setupStatus({ SUPABASE_URL: "https://x", SUPABASE_ANON_KEY: " " });
    assert.equal(status.ok, false);
    assert.equal(status.settings.database, false);
    assert.equal(status.settings.bookingLookup, false);
    assert.ok(!JSON.stringify(status).includes("https://x"));
  });
});
