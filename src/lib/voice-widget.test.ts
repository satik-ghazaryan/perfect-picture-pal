import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { showVoiceWidget, voiceAgentId } from "./voice-widget.ts";

describe("voice widget settings", () => {
  it("accepts only a well-formed ElevenLabs agent id", () => {
    assert.equal(
      voiceAgentId(" agent_7101k5zvyjhmfg983brhmhkd98n6 "),
      "agent_7101k5zvyjhmfg983brhmhkd98n6",
    );
    assert.equal(voiceAgentId(""), null);
    assert.equal(voiceAgentId(undefined), null);
    assert.equal(voiceAgentId("agent_<script>"), null);
    assert.equal(voiceAgentId("7101k5zvyjhmfg983brhmhkd98n6"), null);
  });

  it("shows on customer pages and hides in staff areas", () => {
    assert.equal(showVoiceWidget("/"), true);
    assert.equal(showVoiceWidget("/tours/tatev"), true);
    assert.equal(showVoiceWidget("/loyalty"), true);
    assert.equal(showVoiceWidget("/admin"), false);
    assert.equal(showVoiceWidget("/driver/today"), false);
    assert.equal(showVoiceWidget("/login"), false);
    assert.equal(showVoiceWidget("/administrator-tour"), true);
  });
});
