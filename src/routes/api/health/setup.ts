import { createFileRoute } from "@tanstack/react-router";
import { handleSetupStatus } from "@/lib/setup-check.server";

export const Route = createFileRoute("/api/health/setup")({
  server: {
    handlers: {
      GET: async () => handleSetupStatus(),
    },
  },
});
