import { useEffect } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useSyncExternalStore } from "react";
import {
  getTouristServerSnapshot,
  getTouristSnapshot,
  hydrateAdmin,
  subscribeTourist,
  type TouristSession,
} from "@/lib/admin";

function restrictedRedirect(role: TouristSession["role"], pathname: string) {
  if (pathname === "/login") return null;
  if (role === "guide") return pathname === "/guide" ? null : "/guide";
  if (role === "driver") return pathname === "/driver" ? null : "/driver";
  if (pathname === "/admin" || pathname === "/guide" || pathname === "/driver") return "/";
  return null;
}

export function RoleGate() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const session = useSyncExternalStore(subscribeTourist, getTouristSnapshot, getTouristServerSnapshot);
  const navigate = useNavigate();

  useEffect(() => {
    hydrateAdmin();
  }, []);

  useEffect(() => {
    if (!session) return;
    const next = restrictedRedirect(session.role, pathname);
    if (!next || next === pathname) return;
    void navigate({ to: next });
  }, [session, pathname, navigate]);

  return null;
}
