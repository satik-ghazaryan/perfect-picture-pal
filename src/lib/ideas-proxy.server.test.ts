import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { forwardToPython } from "./ideas-proxy.server.ts";

const originalFetch = globalThis.fetch;
const originalSecret = process.env.IDEAS_API_SECRET;
const originalBackend = process.env.PYTHON_BACKEND_URL;

function captureErrors() {
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  return {
    lines,
    restore() {
      console.error = original;
    },
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalSecret === undefined) delete process.env.IDEAS_API_SECRET;
  else process.env.IDEAS_API_SECRET = originalSecret;
  if (originalBackend === undefined) delete process.env.PYTHON_BACKEND_URL;
  else process.env.PYTHON_BACKEND_URL = originalBackend;
});

describe("ideas upstream log", () => {
  it("keeps an upstream 401 as a generic 502 and logs only the status", async () => {
    process.env.IDEAS_API_SECRET = "x".repeat(32);
    process.env.PYTHON_BACKEND_URL = "https://ideas.example";
    globalThis.fetch = async () => Response.json({ detail: "OPENAI_API_KEY is not configured." }, { status: 401 });
    const logs = captureErrors();
    try {
      const response = await forwardToPython("/api/generate-ideas", {
        method: "POST",
        userId: "00000000-0000-4000-8000-000000000001",
        body: "{}",
        requestId: "c5678-1794233751017-337469a23ecd",
      });
      assert.equal(response.status, 502);
      assert.deepEqual(await response.json(), { error: "Upstream service error" });
      assert.deepEqual(logs.lines, [
        "ideas_upstream request_id=c5678-1794233751017-337469a23ecd upstream_status=401",
      ]);
      assert.equal(logs.lines.some((line) => line.includes("OPENAI") || line.includes("ideas.example")), false);
    } finally {
      logs.restore();
    }
  });

  it("logs a connection failure by error type and hides the message", async () => {
    process.env.IDEAS_API_SECRET = "x".repeat(32);
    process.env.PYTHON_BACKEND_URL = "https://ideas.example";
    globalThis.fetch = async () => {
      throw new TypeError("connect ECONNREFUSED https://ideas.example secret");
    };
    const logs = captureErrors();
    try {
      const response = await forwardToPython("/api/generate-ideas", {
        method: "POST",
        userId: "00000000-0000-4000-8000-000000000001",
        body: "{}",
        requestId: "req-1",
      });
      assert.equal(response.status, 502);
      assert.deepEqual(await response.json(), { error: "Upstream service error" });
      assert.deepEqual(logs.lines, ["ideas_upstream request_id=req-1 error_type=TypeError"]);
    } finally {
      logs.restore();
    }
  });

  it("logs a missing backend configuration without naming the variables", async () => {
    delete process.env.IDEAS_API_SECRET;
    delete process.env.PYTHON_BACKEND_URL;
    const logs = captureErrors();
    try {
      const response = await forwardToPython("/api/generate-ideas", {
        method: "POST",
        userId: "00000000-0000-4000-8000-000000000001",
        body: "{}",
        requestId: "req-2",
      });
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: "Service unavailable" });
      assert.deepEqual(logs.lines, ["ideas_upstream request_id=req-2 error_type=unconfigured"]);
    } finally {
      logs.restore();
    }
  });
});
