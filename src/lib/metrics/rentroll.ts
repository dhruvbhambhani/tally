import { addDays, addMonths, daysBetween, firstOfPeriod, lastOfPeriod, periodOf } from "../dates";
import {
  OCCUPIED_STATUSES,
  type Cents, type Charge, type ISODate, type Lease, type Period, type Unit,
} from "../domain/types";
import { rentForPeriod, type Allocation } from "./ledger";

const isOccupied = (u: Unit) => OCCUPIED_STATUSES.includes(u.status);

export function leaseByUnit(leases: Lease[]): Map<string, Lease> {
  return new Map(leases.map((l) => [l.unitId, l]));
}

// ---------- Unit mix ----------
export interface UnitMixRow {
  unitType: string;
  count: number;
  occupied: number;
  avgSqft: number;
  avgMarketRent: Cents;
  /** average contract rent of occupied units; null when none are occupied */
  avgContractRent: Cents | null;
}

export function unitMix(units: Unit[], leases: Lease[]): UnitMixRow[] {
  const byUnit = leaseByUnit(leases);
  const groups = new Map<string, Unit[]>();
  for (const u of units) {
    if (!groups.has(u.unitType)) groups.set(u.unitType, []);
    groups.get(u.unitType)!.push(u);
  }
  return [...groups.entries()]
    .map(([unitType, us]) => {
      const rents = us.filter(isOccupied).map((u) => byUnit.get(u.id)?.contractRent).filter((r): r is number => r != null);
      return {
        unitType,
        count: us.length,
        occupied: us.filter(isOccupied).length,
        avgSqft: Math.round(us.reduce((t, u) => t + u.sqft, 0) / us.length),
        avgMarketRent: Math.round(us.reduce((t, u) => t + u.marketRent, 0) / us.length),
        avgContractRent: rents.length ? Math.round(rents.reduce((a, b) => a + b, 0) / rents.length) : null,
      };
    })
    .sort((a, b) => a.avgMarketRent - b.avgMarketRent || a.unitType.localeCompare(b.unitType));
}

// ---------- Occupancy ----------
export function physicalOccupancy(units: Unit[]): { occupied: number; total: number; rate: number | null } {
  const occupied = units.filter(isOccupied).length;
  return { occupied, total: units.length, rate: units.length ? occupied / units.length : null };
}

// ---------- Rent potential ----------
/** Gross potential rent: every unit rented at market rent. */
export function grossPotentialRent(units: Unit[]): Cents {
  return units.reduce((t, u) => t + u.marketRent, 0);
}

/** Market rent of units that are not producing rent (vacant, down, model, employee). */
export function vacancyLoss(units: Unit[]): Cents {
  return units.filter((u) => !isOccupied(u)).reduce((t, u) => t + u.marketRent, 0);
}

/** Market rent minus contract rent, summed over occupied units. */
export function lossToLease(units: Unit[], leases: Lease[]): Cents {
  const byUnit = leaseByUnit(leases);
  let t = 0;
  for (const u of units) {
    if (!isOccupied(u)) continue;
    const l = byUnit.get(u.id);
    if (l) t += u.marketRent - l.contractRent;
  }
  return t;
}

/** Concession credits posted for a month (positive number). */
export function concessionsForPeriod(charges: Charge[], period: Period): Cents {
  return charges.filter((c) => c.period === period && c.type === "concession").reduce((t, c) => t - c.amount, 0);
}

export interface WaterfallStep {
  key: "gpr" | "vacancy" | "lossToLease" | "concessions" | "other" | "unpaid" | "collected";
  label: string;
  amount: Cents;
}

export interface Waterfall {
  period: Period;
  gpr: Cents;
  vacancy: Cents;
  lossToLease: Cents;
  concessions: Cents;
  /** any difference between scheduled rent and what was actually billed */
  other: Cents;
  unpaid: Cents;
  collected: Cents;
  /** collected ÷ gross potential rent */
  economicOccupancy: number | null;
  steps: WaterfallStep[];
}

/**
 * From gross potential rent down to rent actually collected for the month.
 * gpr − vacancy − lossToLease − concessions − other − unpaid = collected, always.
 */
export function waterfall(units: Unit[], leases: Lease[], charges: Charge[], alloc: Allocation, period: Period): Waterfall {
  const gpr = grossPotentialRent(units);
  const vacancy = vacancyLoss(units);
  const ltl = lossToLease(units, leases);
  const concessions = concessionsForPeriod(charges, period);
  const { billed, collected } = rentForPeriod(alloc, period);
  const scheduled = gpr - vacancy - ltl - concessions;
  const other = scheduled - billed;
  const unpaid = billed - collected;
  const steps: WaterfallStep[] = [
    { key: "gpr", label: "Possible rent", amount: gpr },
    { key: "vacancy", label: "Empty units", amount: -vacancy },
    { key: "lossToLease", label: "Below-market leases", amount: -ltl },
    { key: "concessions", label: "Discounts", amount: -concessions },
    ...(other !== 0 ? [{ key: "other" as const, label: "Other adjustments", amount: -other }] : []),
    { key: "unpaid", label: "Not yet paid", amount: -unpaid },
    { key: "collected", label: "Collected", amount: collected },
  ];
  return {
    period, gpr, vacancy, lossToLease: ltl, concessions, other, unpaid, collected,
    economicOccupancy: gpr > 0 ? collected / gpr : null, steps,
  };
}

// ---------- Expirations & renewals ----------
export interface ExpirationMonth {
  period: Period;
  count: number;
  leaseIds: string[];
  /** share of all units */
  share: number;
  flagged: boolean;
}

/** Leases ending in each of the next `months` months (month-to-month leases excluded). */
export function expirationSchedule(
  leases: Lease[], unitCount: number, asOf: ISODate, months = 12, flagShare = 0.1,
): ExpirationMonth[] {
  const start = periodOf(asOf);
  const out: ExpirationMonth[] = [];
  for (let i = 0; i < months; i++) {
    const period = addMonths(start, i);
    const ids = leases
      .filter((l) => !l.mtm && l.end && periodOf(l.end) === period && l.end >= asOf)
      .map((l) => l.id);
    const share = unitCount ? ids.length / unitCount : 0;
    out.push({ period, count: ids.length, leaseIds: ids, share, flagged: share > flagShare });
  }
  return out;
}

export function monthToMonth(leases: Lease[]): Lease[] {
  return leases.filter((l) => l.mtm);
}

/** Fixed-term leases ending within `days` of asOf whose unit is not already on notice. */
export function renewalsDue(leases: Lease[], units: Unit[], asOf: ISODate, days: number): Lease[] {
  const unitById = new Map(units.map((u) => [u.id, u]));
  const until = addDays(asOf, days);
  return leases.filter(
    (l) => !l.mtm && l.end != null && l.end >= asOf && l.end <= until && unitById.get(l.unitId)?.status !== "notice",
  );
}

// ---------- Other income, deposits, vacancy ----------
export function otherIncomePerOccupiedUnit(charges: Charge[], units: Unit[], period: Period): { total: Cents; perUnit: Cents | null } {
  const total = charges
    .filter((c) => c.period === period && c.type !== "rent" && c.type !== "concession")
    .reduce((t, c) => t + c.amount, 0);
  const occ = units.filter(isOccupied).length;
  return { total, perUnit: occ ? Math.round(total / occ) : null };
}

export interface DepositSummary {
  held: Cents;
  /** total required across leases where the lease amount is known */
  requiredKnown: Cents;
  knownCount: number;
  shortfalls: { leaseId: string; held: Cents; required: Cents; shortfall: Cents }[];
  shortfallTotal: Cents;
}

export function deposits(leases: Lease[]): DepositSummary {
  const held = leases.reduce((t, l) => t + l.depositHeld, 0);
  const known = leases.filter((l) => l.depositRequired != null);
  const shortfalls = known
    .filter((l) => l.depositHeld < l.depositRequired!)
    .map((l) => ({ leaseId: l.id, held: l.depositHeld, required: l.depositRequired!, shortfall: l.depositRequired! - l.depositHeld }));
  return {
    held,
    requiredKnown: known.reduce((t, l) => t + l.depositRequired!, 0),
    knownCount: known.length,
    shortfalls,
    shortfallTotal: shortfalls.reduce((t, s) => t + s.shortfall, 0),
  };
}

export interface VacancyDays {
  avgDays: number | null;
  units: { unitId: string; days: number; costPerDay: Cents }[];
}

export function daysVacant(units: Unit[], asOf: ISODate): VacancyDays {
  const rows = units
    .filter((u) => u.status === "vacant" && u.vacantSince)
    .map((u) => ({
      unitId: u.id,
      days: Math.max(0, daysBetween(u.vacantSince!, asOf)),
      // market rent spread over a 30-day month
      costPerDay: Math.round(u.marketRent / 30),
    }));
  return { avgDays: rows.length ? Math.round(rows.reduce((t, r) => t + r.days, 0) / rows.length) : null, units: rows };
}

// ---------- Monthly charge posting ----------
/**
 * The charges a lease produces for one month: rent (split tenant/subsidy when
 * there is a voucher), billed recurring charges, and concession credits still in effect.
 */
export function chargesForMonth(lease: Lease, period: Period): Charge[] {
  const due = firstOfPeriod(period);
  if (lease.start > lastOfPeriod(period)) return [];
  const out: Charge[] = [];
  const base = { leaseId: lease.id, dueDate: due, period };
  if (lease.subsidy) {
    out.push({ ...base, id: `${lease.id}:${period}:rent`, type: "rent", amount: lease.subsidy.tenantPortion, payer: "tenant" });
    out.push({ ...base, id: `${lease.id}:${period}:rent-hap`, type: "rent", amount: lease.subsidy.hapPortion, payer: "subsidy" });
  } else {
    out.push({ ...base, id: `${lease.id}:${period}:rent`, type: "rent", amount: lease.contractRent, payer: "tenant" });
  }
  for (const r of lease.recurring) {
    if (r.billed) out.push({ ...base, id: `${lease.id}:${period}:${r.type}`, type: r.type, amount: r.amount, payer: "tenant" });
  }
  lease.concessions.forEach((c, i) => {
    if (c.endsOn >= due) {
      out.push({ ...base, id: `${lease.id}:${period}:concession${i}`, type: "concession", amount: -c.monthlyAmount, payer: "tenant" });
    }
  });
  return out;
}
