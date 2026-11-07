import { createFileRoute } from "@tanstack/react-router";
import { methodNotAllowed } from "@/lib/ideas-proxy.server";
import { handleCreateStaffAccount } from "@/lib/staff-account.server";

export const Route = createFileRoute("/api/staff/accounts")({
  server: {
    handlers: {
      POST: ({ request }) => handleCreateStaffAccount(request),
      GET: async () => methodNotAllowed(),
      PUT: async () => methodNotAllowed(),
      PATCH: async () => methodNotAllowed(),
      DELETE: async () => methodNotAllowed(),
    },
  },
});
