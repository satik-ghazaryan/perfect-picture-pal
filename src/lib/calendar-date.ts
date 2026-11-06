import { format, parseISO } from "date-fns";
import { hy } from "date-fns/locale";

export const UNASSIGNED_DEPARTURE_LABEL = "Մեկնման ամսաթիվը դեռ նշանակված չէ";

export function isValidIsoDate(value: string | null | undefined) {
  if (!value || typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return false;
  const parsed = parseISO(trimmed.length > 10 ? trimmed : `${trimmed}T12:00:00`);
  return !Number.isNaN(parsed.getTime());
}

export function formatAssignedDepartureDate(value: string | null | undefined) {
  if (!isValidIsoDate(value) || !value) return UNASSIGNED_DEPARTURE_LABEL;
  const trimmed = value.trim();
  const parsed = parseISO(trimmed.length > 10 ? trimmed : `${trimmed}T12:00:00`);
  return format(parsed, "d MMMM yyyy", { locale: hy });
}

export function weekendScheduleLabel(day: "saturday" | "sunday") {
  return day === "sunday" ? "Կիրակի" : "Շաբաթ";
}
