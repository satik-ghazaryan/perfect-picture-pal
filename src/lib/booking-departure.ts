import { format } from "date-fns";
import { hy } from "date-fns/locale";
import { assignedWeekendDay, UNASSIGNED_SCHEDULE_LABEL } from "./calendar-date";

export { UNASSIGNED_SCHEDULE_LABEL };

export type BookingScheduleDay = "saturday" | "sunday" | "";

export function nextAssignedDeparture(day: BookingScheduleDay, now = new Date()): Date | null {
  const weekend = assignedWeekendDay(day);
  if (!weekend) return null;
  const target = weekend === "saturday" ? 6 : 0;
  const date = new Date(now);
  date.setDate(now.getDate() + ((target - now.getDay() + 7) % 7 || 7));
  return date;
}

export function bookingDepartureLabel(day: BookingScheduleDay, now = new Date()) {
  const date = nextAssignedDeparture(day, now);
  if (!date) return UNASSIGNED_SCHEDULE_LABEL;
  return format(date, "d MMMM, EEEE", { locale: hy });
}

export function bookingTicketDateLabel(day: BookingScheduleDay, now = new Date()) {
  const date = nextAssignedDeparture(day, now);
  if (!date) return UNASSIGNED_SCHEDULE_LABEL;
  return format(date, "d MMMM", { locale: hy });
}

export function bookingCrewDepartureDate(day: BookingScheduleDay, now = new Date()) {
  const date = nextAssignedDeparture(day, now);
  if (!date) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const dayOfMonth = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${dayOfMonth}`;
}

export function bookingDayAssigned(day: BookingScheduleDay) {
  return assignedWeekendDay(day) !== null;
}

export async function confirmBookingIfDayAssigned<T>(
  day: BookingScheduleDay,
  complete: () => Promise<T>,
): Promise<{ ok: true; result: T } | { ok: false; message: string }> {
  if (!bookingDayAssigned(day)) {
    return { ok: false, message: UNASSIGNED_SCHEDULE_LABEL };
  }
  return { ok: true, result: await complete() };
}
