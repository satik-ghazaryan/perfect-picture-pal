import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import {
  leadFromWebhook,
  leadMessage,
  leadNeedsOperator,
  verifyElevenLabsSignature,
} from "./voice-post-call.ts";

const secret = "wsec_test_secret_123";
const now = 1_795_000_000;

function sign(body: string, timestamp = now, key = secret) {
  const hash = createHmac("sha256", key).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v0=${hash}`;
}

const event = {
  type: "post_call_transcription",
  event_timestamp: now,
  data: {
    agent_id: "agent_0201m7waycjwe3x9kb49a1g8wnhs",
    conversation_id: "conv_01abc",
    metadata: { call_duration_secs: 84 },
    analysis: {
      transcript_summary: "Զանգողը ուզում է գրանցվել Տաթևի տուրին <2 հոգով>.",
      data_collection_results: {
        customer_name: { data_collection_id: "customer_name", value: "Արամ" },
        phone: { data_collection_id: "phone", value: "094123456" },
        tour: { data_collection_id: "tour", value: "Տաթև" },
        tour_date: { data_collection_id: "tour_date", value: "2026-11-28" },
        people_count: { data_collection_id: "people_count", value: "2 մեծ, 1 երեխա 2 տարեկան" },
        interested_direction: { data_collection_id: "interested_direction", value: null },
      },
    },
  },
};

describe("ElevenLabs signature", () => {
  const body = JSON.stringify(event);

  it("accepts a fresh, correctly signed body", () => {
    assert.equal(verifyElevenLabsSignature(body, sign(body), secret, now + 5), true);
  });

  it("rejects a changed body, wrong secret, old timestamp and junk headers", () => {
    assert.equal(verifyElevenLabsSignature(`${body} `, sign(body), secret, now), false);
    assert.equal(
      verifyElevenLabsSignature(body, sign(body, now, "other_secret"), secret, now),
      false,
    );
    assert.equal(verifyElevenLabsSignature(body, sign(body, now - 3600), secret, now), false);
    assert.equal(verifyElevenLabsSignature(body, null, secret, now), false);
    assert.equal(verifyElevenLabsSignature(body, "t=abc,v0=xyz", secret, now), false);
    assert.equal(verifyElevenLabsSignature(body, sign(body), "", now), false);
  });
});

describe("lead from webhook", () => {
  const lead = leadFromWebhook(event);

  it("reads the collected fields and treats null as empty", () => {
    assert.ok(lead);
    assert.equal(lead.name, "Արամ");
    assert.equal(lead.phone, "094123456");
    assert.equal(lead.tourDate, "2026-11-28");
    assert.equal(lead.interestedDirection, "");
    assert.equal(lead.durationSeconds, 84);
    assert.equal(leadNeedsOperator(lead), true);
  });

  it("ignores other event types and empty calls", () => {
    assert.equal(leadFromWebhook({ type: "post_call_audio", data: {} }), null);
    assert.equal(leadFromWebhook("nope"), null);
    const empty = leadFromWebhook({ type: "post_call_transcription", data: {} });
    assert.ok(empty);
    assert.equal(leadNeedsOperator(empty), false);
  });

  it("formats an escaped Armenian Telegram message with a link to the call", () => {
    assert.ok(lead);
    const message = leadMessage(lead);
    assert.match(message, /<b>Հեռախոս՝<\/b> 094123456/);
    assert.match(message, /&lt;2 հոգով&gt;/);
    assert.match(message, /elevenlabs\.io\/app\/agents\/history\/conv_01abc/);
    assert.doesNotMatch(message, /Հետաքրքրված է/);
  });

  it("warns the operator when no phone was left", () => {
    const interest = leadFromWebhook({
      type: "post_call_transcription",
      data: {
        analysis: {
          data_collection_results: { interested_direction: { value: "Մեղրի" } },
        },
      },
    });
    assert.ok(interest);
    assert.equal(leadNeedsOperator(interest), true);
    assert.match(leadMessage(interest), /Հեռախոսահամար չի թողել/);
  });
});
