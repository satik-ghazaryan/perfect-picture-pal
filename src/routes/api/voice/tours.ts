import { createFileRoute } from "@tanstack/react-router";
import { loadPublicTourFacts } from "@/lib/tour-chat.server";
import { voiceToursPayload, type VoiceToursPayload } from "@/lib/voice-tours";

// Read-only tour catalog for the ElevenLabs phone agent (webhook tool).
// Returns the same public data the home page shows: no bookings, no personal data.
// All agent calls arrive from ElevenLabs' servers, so instead of a per-IP limit
// a short cache keeps database reads bounded while seats stay near-live.
const CACHE_MS = 30_000;
let cached: { at: number; payload: VoiceToursPayload } | null = null;

export const Route = createFileRoute("/api/voice/tours")({
  server: {
    handlers: {
      GET: async () => {
        const now = Date.now();
        let entry = cached;
        if (!entry || now - entry.at > CACHE_MS) {
          const payload = voiceToursPayload(await loadPublicTourFacts());
          entry = payload.ok ? { at: now, payload } : null;
          cached = entry;
          if (!entry) {
            return Response.json(payload, {
              status: 503,
              headers: { "cache-control": "no-store" },
            });
          }
        }
        return Response.json(entry.payload, { headers: { "cache-control": "no-store" } });
      },
    },
  },
});
