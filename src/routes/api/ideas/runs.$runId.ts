import { createFileRoute } from "@tanstack/react-router";
import { forwardToPython, isUuid, jsonError, methodNotAllowed, requireAdmin } from "@/lib/ideas-proxy.server";

async function handleGet({ request, params }: { request: Request; params: { runId: string } }) {
  const admin = await requireAdmin(request);
  if (admin instanceof Response) return admin;
  const runId = params.runId?.trim() ?? "";
  if (!isUuid(runId)) return jsonError(404, "Not found");
  return forwardToPython(`/api/idea-runs/${encodeURIComponent(runId)}`, {
    method: "GET",
    userId: admin.userId,
  });
}

export const Route = createFileRoute("/api/ideas/runs/$runId")({
  server: {
    handlers: {
      GET: handleGet,
      POST: async () => methodNotAllowed(),
      PUT: async () => methodNotAllowed(),
      PATCH: async () => methodNotAllowed(),
      DELETE: async () => methodNotAllowed(),
    },
  },
});
