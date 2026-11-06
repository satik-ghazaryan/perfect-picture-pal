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

export const UNASSIGNED_SCHEDULE_LABEL = "Մեկնման օրը դեռ նշանակված չէ";

export function weekendDayFromIsoDate(
  value: string | null | undefined,
): "saturday" | "sunday" | null {
  if (!isValidIsoDate(value) || !value) return null;
  const trimmed = value.trim();
  const parsed = parseISO(trimmed.length > 10 ? trimmed : `${trimmed}T12:00:00`);
  const weekday = parsed.getDay();
  if (weekday === 0) return "sunday";
  if (weekday === 6) return "saturday";
  return null;
}

export function assignedWeekendDay(day: string | null | undefined): "saturday" | "sunday" | null {
  return day === "saturday" || day === "sunday" ? day : null;
}

export function weekendScheduleLabel(day: string | null | undefined) {
  if (day === "sunday") return "Կիրակի";
  if (day === "saturday") return "Շաբաթ";
  return UNASSIGNED_SCHEDULE_LABEL;
}

export function catalogDayFromRow(
  raw: Record<string, unknown>,
  seedFallback = false,
  fallbackDay: "saturday" | "sunday" = "saturday",
): "saturday" | "sunday" | "" {
  const explicit = raw["day"];
  if (explicit === "saturday" || explicit === "sunday") return explicit;
  const inferred = weekendDayFromIsoDate(
    typeof raw["departure_date"] === "string"
      ? raw["departure_date"]
      : typeof raw["departureDate"] === "string"
        ? raw["departureDate"]
        : null,
  );
  if (inferred) return inferred;
  if (seedFallback) return fallbackDay;
  return "";
}
