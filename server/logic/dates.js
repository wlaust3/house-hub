// Pure date helpers on 'YYYY-MM-DD' strings. All math is done in UTC so that DST can never
// shift a date; the strings themselves are the house's local calendar days.

const RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidDate(s) {
  if (typeof s !== "string") return false;
  const m = RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function parts(s) {
  const m = RE.exec(s);
  if (!m) throw new Error(`Bad date: ${s}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function fmt(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function toDays(s) {
  const [y, m, d] = parts(s);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

export function addDays(s, n) {
  return fmt((toDays(s) + n) * 86400000);
}

export function diffDays(a, b) {
  return toDays(a) - toDays(b);
}

export function daysInMonth(y, m1) {
  return new Date(Date.UTC(y, m1, 0)).getUTCDate();
}

/** Add `k` calendar months to `anchor`, keeping the anchor's day-of-month, clamped to month end. */
export function addMonthsClamped(anchor, k) {
  const [y, m, d] = parts(anchor);
  const idx = y * 12 + (m - 1) + k;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12 + 12) % 12 + 1;
  const nd = Math.min(d, daysInMonth(ny, nm));
  return `${String(ny).padStart(4, "0")}-${String(nm).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}

/** Whole calendar months from a's month to b's month (ignores the day). */
export function monthIndexDiff(a, b) {
  const [ay, am] = parts(a);
  const [by, bm] = parts(b);
  return (by * 12 + bm) - (ay * 12 + am);
}

/** ISO weekday: 1 = Monday ... 7 = Sunday. */
export function isoWeekday(s) {
  const [y, m, d] = parts(s);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() || 7;
}

export function maxDate(a, b) {
  return a >= b ? a : b;
}

/** Local calendar date of a JS Date in the server's time zone (set TZ for the house). */
export function localDate(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
