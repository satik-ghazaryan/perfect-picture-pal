/** Milliseconds until a one-day tour leaves. Negative after departure. */
export function timeUntilDeparture(date: string, time: string, now = new Date()) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  const hours = match ? Number(match[1]) : 0;
  const minutes = match ? Number(match[2]) : 0;
  const at = new Date(`${date}T00:00:00`);
  if (Number.isNaN(at.getTime())) return null;
  at.setHours(hours, minutes, 0, 0);
  return at.getTime() - now.getTime();
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Guide and driver details open once the departure is 24 hours away or sooner. */
export function crewRevealed(date: string, time: string, now = new Date()) {
  const remaining = timeUntilDeparture(date, time, now);
  return remaining !== null && remaining <= DAY_MS;
}

export function formatTimeRemaining(remaining: number) {
  if (remaining <= 0) return "Մեկնումը սկսվել է";
  const totalMinutes = Math.floor(remaining / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `Մեկնմանը մնացել է ${days} օր${hours > 0 ? ` ${hours} ժամ` : ""}`;
  if (hours > 0) return `Մեկնմանը մնացել է ${hours} ժամ${minutes > 0 ? ` ${minutes} րոպե` : ""}`;
  return `Մեկնմանը մնացել է ${Math.max(minutes, 1)} րոպե`;
}
