import { daysBetween } from "../dates";
import type { Cents, Charge, ISODate, LateFeePolicy, PayerType, Payment, Period } from "../domain/types";

export interface ChargeState {
  charge: Charge;
  /** amount due after same-period concession credits */
  due: Cents;
  paid: Cents;
  open: Cents;
  /** date the charge became fully paid, if it has */
  paidOn: ISODate | null;
}

export interface Allocation {
  states: ChargeState[];
  /** money received beyond what was billed, per lease */
  unapplied: Map<string, Cents>;
}

const TYPE_ORDER: Record<string, number> = {
  rent: 0, pet: 1, parking: 1, storage: 1, utilities: 1, other: 1, late_fee: 2,
};

/**
 * Apply payments to charges, oldest charge first (FIFO), separately for the
 * tenant's share and the subsidy's share of each lease.
 * Concession credits reduce the same period's rent before any payment applies.
 */
export function allocatePayments(charges: Charge[], payments: Payment[]): Allocation {
  const states: ChargeState[] = [];
  const unapplied = new Map<string, Cents>();
  const key = (leaseId: string, payer: PayerType) => `${leaseId}|${payer}`;

  const byKey = new Map<string, ChargeState[]>();
  const credits = new Map<string, Cents>(); // leaseId|payer|period → credit

  for (const c of charges) {
    if (c.amount < 0) {
      const k = `${key(c.leaseId, c.payer)}|${c.period}`;
      credits.set(k, (credits.get(k) ?? 0) + -c.amount);
    }
  }
  for (const c of charges) {
    if (c.amount < 0) continue;
    const s: ChargeState = { charge: c, due: c.amount, paid: 0, open: c.amount, paidOn: null };
    states.push(s);
    const k = key(c.leaseId, c.payer);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(s);
  }
  for (const list of byKey.values()) {
    list.sort(
      (a, b) =>
        a.charge.dueDate.localeCompare(b.charge.dueDate) ||
        (TYPE_ORDER[a.charge.type] ?? 1) - (TYPE_ORDER[b.charge.type] ?? 1) ||
        a.charge.id.localeCompare(b.charge.id),
    );
    // consume concession credits against that period's rent first
    for (const s of list) {
      if (s.charge.type !== "rent") continue;
      const k = `${key(s.charge.leaseId, s.charge.payer)}|${s.charge.period}`;
      const credit = credits.get(k) ?? 0;
      if (credit > 0) {
        const used = Math.min(credit, s.due);
        s.due -= used;
        s.open -= used;
        credits.set(k, credit - used);
      }
    }
  }

  const sorted = [...payments]
    .filter((p) => p.leaseId)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  for (const p of sorted) {
    let left = p.amount;
    const list = byKey.get(key(p.leaseId!, p.payerType)) ?? [];
    for (const s of list) {
      if (left <= 0) break;
      if (s.open <= 0) continue;
      const applied = Math.min(left, s.open);
      s.paid += applied;
      s.open -= applied;
      left -= applied;
      if (s.open === 0) s.paidOn = p.date;
    }
    if (left > 0) unapplied.set(p.leaseId!, (unapplied.get(p.leaseId!) ?? 0) + left);
  }
  return { states, unapplied };
}

export const AGING_BUCKETS = ["current", "1-30", "31-60", "61-90", "90+"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];
export type AgingTotals = Record<AgingBucket, Cents>;

export function bucketFor(daysPastDue: number): AgingBucket {
  if (daysPastDue <= 0) return "current";
  if (daysPastDue <= 30) return "1-30";
  if (daysPastDue <= 60) return "31-60";
  if (daysPastDue <= 90) return "61-90";
  return "90+";
}

const emptyAging = (): AgingTotals => ({ current: 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0 });

export interface LeaseAging {
  leaseId: string;
  balance: Cents;
  buckets: AgingTotals;
  /** bucket of the oldest unpaid charge */
  oldestBucket: AgingBucket;
  oldestDueDate: ISODate;
  daysLate: number;
  /** unpaid late fees included in `balance` */
  lateFeesOpen: Cents;
  openCharges: ChargeState[];
}

export interface AgingReport {
  totals: AgingTotals;
  total: Cents;
  byLease: LeaseAging[];
}

/**
 * Delinquency aging as of a date. Each unpaid charge is placed in the bucket
 * for how many days it is past due. Only what the given payer owes is counted
 * (default: the tenant's own share, not the voucher's).
 */
export function aging(alloc: Allocation, asOf: ISODate, payer: PayerType = "tenant"): AgingReport {
  const totals = emptyAging();
  const map = new Map<string, LeaseAging>();
  for (const s of alloc.states) {
    if (s.open <= 0 || s.charge.payer !== payer || s.charge.dueDate > asOf) continue;
    const days = daysBetween(s.charge.dueDate, asOf);
    const b = bucketFor(days);
    totals[b] += s.open;
    let la = map.get(s.charge.leaseId);
    if (!la) {
      la = {
        leaseId: s.charge.leaseId, balance: 0, buckets: emptyAging(), oldestBucket: b,
        oldestDueDate: s.charge.dueDate, daysLate: days, lateFeesOpen: 0, openCharges: [],
      };
      map.set(s.charge.leaseId, la);
    }
    la.balance += s.open;
    la.buckets[b] += s.open;
    la.openCharges.push(s);
    if (s.charge.type === "late_fee") la.lateFeesOpen += s.open;
    if (days > la.daysLate) {
      la.daysLate = days;
      la.oldestBucket = b;
      la.oldestDueDate = s.charge.dueDate;
    }
  }
  const byLease = [...map.values()].sort((a, b) => b.balance - a.balance);
  for (const la of byLease) la.openCharges.sort((a, b) => a.charge.dueDate.localeCompare(b.charge.dueDate));
  const total = AGING_BUCKETS.reduce((t, b) => t + totals[b], 0);
  return { totals, total, byLease };
}

export interface PeriodCollection {
  period: Period;
  billed: Cents;
  collected: Cents;
  /** collected ÷ billed; null when nothing was billed */
  rate: number | null;
}

/** Of everything billed for a month, how much has been paid so far. */
export function collectionForPeriod(alloc: Allocation, period: Period): PeriodCollection {
  let billed = 0;
  let collected = 0;
  for (const s of alloc.states) {
    if (s.charge.period !== period) continue;
    billed += s.due;
    collected += s.paid;
  }
  return { period, billed, collected, rate: billed > 0 ? collected / billed : null };
}

export function collectionTrend(alloc: Allocation, periods: Period[]): PeriodCollection[] {
  return periods.map((p) => collectionForPeriod(alloc, p));
}

/** Rent (after concessions) billed and collected for a month, across tenant and subsidy shares. */
export function rentForPeriod(alloc: Allocation, period: Period): { billed: Cents; collected: Cents } {
  let billed = 0;
  let collected = 0;
  for (const s of alloc.states) {
    if (s.charge.period !== period || s.charge.type !== "rent") continue;
    billed += s.due;
    collected += s.paid;
  }
  return { billed, collected };
}

export interface LateMonth {
  leaseId: string;
  period: Period;
  /** date the tenant's rent for the month was fully paid; null = still unpaid */
  paidOn: ISODate | null;
  feeCharged: boolean;
}

/**
 * Months in which a tenant's rent was paid after the grace day (or is still
 * unpaid past it), and whether a late fee was charged for that month.
 */
export function lateMonths(alloc: Allocation, policy: LateFeePolicy, asOf: ISODate): LateMonth[] {
  const feeMonths = new Set<string>();
  for (const s of alloc.states) {
    if (s.charge.type === "late_fee") feeMonths.add(`${s.charge.leaseId}|${s.charge.period}`);
  }
  const out: LateMonth[] = [];
  for (const s of alloc.states) {
    const c = s.charge;
    if (c.type !== "rent" || c.payer !== "tenant" || s.due <= 0) continue;
    const graceEnd = `${c.period}-${String(policy.graceDay).padStart(2, "0")}`;
    const late = s.paidOn ? s.paidOn > graceEnd : asOf > graceEnd;
    if (!late) continue;
    out.push({ leaseId: c.leaseId, period: c.period, paidOn: s.paidOn, feeCharged: feeMonths.has(`${c.leaseId}|${c.period}`) });
  }
  return out.sort((a, b) => a.period.localeCompare(b.period) || a.leaseId.localeCompare(b.leaseId));
}
