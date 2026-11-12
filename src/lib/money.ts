import type { Cents } from "./domain/types";

/** "$1,450" or "$1,450.50" — cents shown only when they are not zero. */
export function money(cents: Cents | null | undefined, opts: { cents?: boolean } = {}): string {
  if (cents == null) return "—";
  const showCents = opts.cents ?? cents % 100 !== 0;
  const s = (Math.abs(cents) / 100).toLocaleString("en-US", {
    minimumFractionDigits: showCents ? 2 : 0,
    maximumFractionDigits: showCents ? 2 : 0,
  });
  return `${cents < 0 ? "-" : ""}$${s}`;
}

export function pct(ratio: number | null | undefined, digits = 1): string {
  if (ratio == null || !isFinite(ratio)) return "—";
  return `${(ratio * 100).toFixed(digits)}%`;
}

/** Parse "$1,450.00", "1450", "(200.00)" → cents. Null when not a number. */
export function parseMoney(raw: unknown): Cents | null {
  if (raw == null) return null;
  if (typeof raw === "number") return isFinite(raw) ? Math.round(raw * 100) : null;
  let s = String(raw).trim();
  if (!s) return null;
  const neg = /^\(.*\)$/.test(s) || s.startsWith("-");
  s = s.replace(/[$,\s()\-]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const v = Math.round(parseFloat(s) * 100);
  return neg ? -v : v;
}

export const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
