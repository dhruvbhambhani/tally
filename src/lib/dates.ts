import type { ISODate, Period } from "./domain/types";

const MS_DAY = 86_400_000;

function toUTC(d: ISODate): number {
  const [y, m, day] = d.split("-").map(Number);
  return Date.UTC(y, m - 1, day);
}

export function fromUTC(ms: number): ISODate {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (positive when b is later). */
export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((toUTC(b) - toUTC(a)) / MS_DAY);
}

export function addDays(d: ISODate, n: number): ISODate {
  return fromUTC(toUTC(d) + n * MS_DAY);
}

export function periodOf(d: ISODate): Period {
  return d.slice(0, 7);
}

export function firstOfPeriod(p: Period): ISODate {
  return `${p}-01`;
}

export function lastOfPeriod(p: Period): ISODate {
  const [y, m] = p.split("-").map(Number);
  return fromUTC(Date.UTC(y, m, 0));
}

export function addMonths(p: Period, n: number): Period {
  const [y, m] = p.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

/** Inclusive list of periods from `from` to `to`. */
export function periodsBetween(from: Period, to: Period): Period[] {
  const out: Period[] = [];
  for (let p = from; p <= to; p = addMonths(p, 1)) out.push(p);
  return out;
}

function valid(y: number, m: number, d: number): ISODate | null {
  if (!(y >= 1900 && y <= 2200) || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  // Rejects impossible dates such as 06/31.
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * Parse the date formats owners actually use. Returns null (never a guess)
 * when the value is not a real calendar date.
 */
export function parseDate(raw: unknown, defaultYear?: number): ISODate | null {
  if (raw == null) return null;
  if (raw instanceof Date && !isNaN(raw.getTime())) return raw.toISOString().slice(0, 10);
  if (typeof raw === "number" && raw > 20000 && raw < 80000) {
    // Excel serial date
    return fromUTC(Date.UTC(1899, 11, 30) + Math.round(raw) * MS_DAY);
  }
  const s = String(raw).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})$/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return valid(y, +m[1], +m[2]);
  }
  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})$/);
  if (m && defaultYear) return valid(defaultYear, +m[1], +m[2]);
  m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const mi = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    if (mi >= 0) return valid(+m[3], mi + 1, +m[2]);
  }
  return null;
}

export function formatDate(d: ISODate | null | undefined, style: "short" | "long" | "month" = "short"): string {
  if (!d) return "—";
  const dt = new Date(toUTC(d.length === 7 ? `${d}-01` : d));
  const opts: Intl.DateTimeFormatOptions =
    style === "long"
      ? { month: "long", day: "numeric", year: "numeric" }
      : style === "month"
        ? { month: "short", year: "numeric" }
        : { month: "short", day: "numeric", year: "numeric" };
  return dt.toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
}
