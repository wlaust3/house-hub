// All dates come from the server as 'YYYY-MM-DD' (house local calendar day) and are formatted
// with Intl.DateTimeFormat in the active locale. Never format dates by hand.
import { getLocale, t } from "./i18n";

function local(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function weekdayName(date: string, style: "long" | "short" = "long"): string {
  return new Intl.DateTimeFormat(getLocale(), { weekday: style }).format(local(date));
}

export function weekdayFromIso(iso: number, style: "long" | "short" = "long"): string {
  // 2024-01-01 is a Monday
  return weekdayName(`2024-01-${String(iso).padStart(2, "0")}`, style);
}

export function dayLong(date: string): string {
  return new Intl.DateTimeFormat(getLocale(), { weekday: "long", month: "short", day: "numeric" }).format(local(date));
}

export function monthTitle(month: string): string {
  return new Intl.DateTimeFormat(getLocale(), { month: "long", year: "numeric" }).format(local(`${month}-01`));
}

/** "Today", "Tomorrow", otherwise the weekday name (or weekday + date when far away). */
export function dayLabel(date: string, today: string): string {
  if (date === today) return t("date.today");
  const diff = Math.round((local(date).getTime() - local(today).getTime()) / 86400000);
  if (diff === 1) return t("date.tomorrow");
  if (diff > 1 && diff < 7) return weekdayName(date);
  return dayLong(date);
}

/** "Mon 3:42 PM" from an ISO UTC timestamp. */
export function stamp(iso: string): string {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat(getLocale(), { weekday: "short" }).format(d);
  const time = new Intl.DateTimeFormat(getLocale(), { hour: "numeric", minute: "2-digit" }).format(d);
  return `${day} ${time}`;
}

export function addMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
