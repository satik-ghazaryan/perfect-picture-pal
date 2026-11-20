import { createElement, useEffect, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import {
  VOICE_WIDGET_SCRIPT,
  VOICE_WIDGET_TEXT,
  showVoiceWidget,
  voiceAgentId,
} from "@/lib/voice-widget";

const agentId = voiceAgentId(import.meta.env.VITE_ELEVENLABS_AGENT_ID);

/**
 * "Call Ani" button: the ElevenLabs voice agent, talking in the browser.
 * Off until VITE_ELEVENLABS_AGENT_ID is set in Vercel. Position and colors
 * are set in the ElevenLabs dashboard (Widget tab); use bottom-left so it does
 * not cover the tour chat on the right.
 */
export function VoiceAgentWidget() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [mounted, setMounted] = useState(false);
  const visible = Boolean(agentId) && showVoiceWidget(pathname);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!visible || document.querySelector(`script[src="${VOICE_WIDGET_SCRIPT}"]`)) return;
    const script = document.createElement("script");
    script.src = VOICE_WIDGET_SCRIPT;
    script.async = true;
    script.type = "text/javascript";
    document.body.appendChild(script);
  }, [visible]);

  if (!mounted || !visible || !agentId) return null;
  return createElement("elevenlabs-convai", { "agent-id": agentId, ...VOICE_WIDGET_TEXT });
}
