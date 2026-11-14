import { createFileRoute } from "@tanstack/react-router";
import { methodNotAllowed } from "@/lib/ideas-proxy.server";
import {
  handleCreateStaffAccount,
  handleListDisabledStaff,
  handleSetStaffActive,
  handleUpdateStaffAccount,
} from "@/lib/staff-account.server";

export const Route = createFileRoute("/api/staff/accounts")({
  server: {
    handlers: {
      POST: ({ request }) => handleCreateStaffAccount(request),
      GET: ({ request }) => handleListDisabledStaff(request),
      PUT: ({ request }) => handleSetStaffActive(request),
      PATCH: ({ request }) => handleUpdateStaffAccount(request),
      DELETE: async () => methodNotAllowed(),
    },
  },
});
