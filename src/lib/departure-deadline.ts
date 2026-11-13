export const DEPARTURE_CLOSED_MESSAGE = "Այս մեկնման ամրագրումն արդեն փակ է";

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

/** Start instant of a departure in Asia/Yerevan. Blank or invalid times have no start. */
export function yerevanDepartureStart(date: string, time: string): Date | null {
  const day = DATE.exec(date);
  const clock = TIME.exec(time.trim());
  if (!day || !clock) return null;
  const year = Number(day[1]);
  const month = Number(day[2]);
  const dayOfMonth = Number(day[3]);
  const parsed = new Date(Date.UTC(year, month - 1, dayOfMonth));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== dayOfMonth
  ) {
    return null;
  }
  const seconds = clock[3] ?? "00";
  const start = new Date(`${date}T${clock[1]}:${clock[2]}:${seconds}+04:00`);
  return Number.isNaN(start.getTime()) ? null : start;
}

/** New bookings close at the Yerevan start instant, and when the stored time cannot be read. */
export function departureBookingClosed(date: string, time: string, now = new Date()) {
  const start = yerevanDepartureStart(date, time);
  if (!start) return true;
  return now.getTime() >= start.getTime();
}

export type UpcomingDepartureInput = {
  id: string;
  tourId: string;
  departureDate: string;
  availableSeats: number;
  departureTime: string;
};

/** Published departures whose Yerevan start is still ahead, nearest first. Sold-out rows stay visible. */
export function upcomingDepartures<T extends UpcomingDepartureInput>(rows: T[], now = new Date()) {
  return rows
    .filter((row) => !departureBookingClosed(row.departureDate, row.departureTime, now))
    .slice()
    .sort((left, right) => {
      const leftStart =
        yerevanDepartureStart(left.departureDate, left.departureTime)?.getTime() ?? 0;
      const rightStart =
        yerevanDepartureStart(right.departureDate, right.departureTime)?.getTime() ?? 0;
      return leftStart - rightStart || left.id.localeCompare(right.id);
    });
}
