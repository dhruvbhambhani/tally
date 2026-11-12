/**
 * One place that runs every deterministic metric for a property. Screens,
 * exports, recommendations, letters and Ask Tally all read from this — so a
 * number is computed once, the same way, everywhere.
 */
import { addMonths, periodOf, periodsBetween } from "./dates";
import type { PropertyData } from "./data/load";
import type { Cents, ISODate, Lease, Unit } from "./domain/types";
import { evaluateBenchmarks, type BenchmarkResult } from "./metrics/benchmarks";
import {
  aging, allocatePayments, collectionForPeriod, collectionTrend, lateMonths,
  type AgingReport, type Allocation, type LateMonth, type LeaseAging, type PeriodCollection,
} from "./metrics/ledger";
import {
  daysVacant, deposits, expirationSchedule, monthToMonth, otherIncomePerOccupiedUnit, physicalOccupancy, renewalsDue,
  unitMix, waterfall, type DepositSummary, type ExpirationMonth, type UnitMixRow, type VacancyDays, type Waterfall,
} from "./metrics/rentroll";

export interface RentRollRow {
  unitId: string;
  unit: string;
  unitType: string;
  sqft: number;
  status: Unit["status"];
  leaseId: string | null;
  resident: string;
  leaseStart: ISODate | null;
  leaseEnd: ISODate | null;
  mtm: boolean;
  marketRent: Cents;
  contractRent: Cents | null;
  otherCharges: Cents;
  concessions: Cents;
  deposit: Cents | null;
  balance: Cents;
  lastPayment: { date: ISODate; amount: Cents } | null;
}

export interface Analysis {
  asOf: ISODate;
  period: string;
  alloc: Allocation;
  waterfall: Waterfall;
  occupancy: { occupied: number; total: number; rate: number | null };
  unitMix: UnitMixRow[];
  aging: AgingReport;
  agingByLease: Map<string, LeaseAging>;
  collection: PeriodCollection;
  trend: PeriodCollection[];
  expirations: ExpirationMonth[];
  mtm: Lease[];
  renewals: { d30: Lease[]; d60: Lease[]; d90: Lease[] };
  otherIncome: { total: Cents; perUnit: Cents | null };
  deposits: DepositSummary;
  vacancy: VacancyDays;
  benchmarks: BenchmarkResult[];
  late: LateMonth[];
  rentRoll: RentRollRow[];
}

export function analyze(data: PropertyData): Analysis {
  const { snapshot: s, settings, policy } = data;
  const period = periodOf(s.asOf);
  const alloc = allocatePayments(s.charges, s.payments);
  const wf = waterfall(s.units, s.leases, s.charges, alloc, period);
  const occupancy = physicalOccupancy(s.units);
  const ag = aging(alloc, s.asOf);
  const agingByLease = new Map(ag.byLease.map((l) => [l.leaseId, l]));
  const firstPeriod = s.charges.reduce((min, c) => (c.period < min ? c.period : min), period);
  const trendStart = firstPeriod < addMonths(period, -11) ? addMonths(period, -11) : firstPeriod;

  const leaseByUnit = new Map(s.leases.map((l) => [l.unitId, l]));
  const lastPay = new Map<string, { date: ISODate; amount: Cents }>();
  for (const p of s.payments) {
    if (!p.leaseId || p.payerType !== "tenant") continue;
    const cur = lastPay.get(p.leaseId);
    if (!cur || p.date > cur.date) lastPay.set(p.leaseId, { date: p.date, amount: p.amount });
  }
  const rentRoll: RentRollRow[] = s.units.map((u) => {
    const l = leaseByUnit.get(u.id);
    return {
      unitId: u.id, unit: u.number, unitType: u.unitType, sqft: u.sqft, status: u.status, leaseId: l?.id ?? null,
      resident: l ? l.residents.join(", ") : "", leaseStart: l?.start ?? null, leaseEnd: l?.end ?? null, mtm: l?.mtm ?? false,
      marketRent: u.marketRent, contractRent: l?.contractRent ?? null,
      otherCharges: l ? l.recurring.filter((r) => r.billed).reduce((t, r) => t + r.amount, 0) : 0,
      concessions: l ? l.concessions.filter((c) => c.endsOn >= s.asOf).reduce((t, c) => t + c.monthlyAmount, 0) : 0,
      deposit: l?.depositHeld ?? null,
      balance: l ? (agingByLease.get(l.id)?.balance ?? 0) : 0,
      lastPayment: l ? (lastPay.get(l.id) ?? null) : null,
    };
  });

  return {
    asOf: s.asOf, period, alloc, waterfall: wf, occupancy,
    unitMix: unitMix(s.units, s.leases),
    aging: ag, agingByLease,
    collection: collectionForPeriod(alloc, period),
    trend: collectionTrend(alloc, periodsBetween(trendStart, period)),
    expirations: expirationSchedule(s.leases, s.units.length, s.asOf, 12, settings.expirationFlagShare),
    mtm: monthToMonth(s.leases),
    renewals: { d30: renewalsDue(s.leases, s.units, s.asOf, 30), d60: renewalsDue(s.leases, s.units, s.asOf, 60), d90: renewalsDue(s.leases, s.units, s.asOf, 90) },
    otherIncome: otherIncomePerOccupiedUnit(s.charges, s.units, period),
    deposits: deposits(s.leases),
    vacancy: daysVacant(s.units, s.asOf),
    benchmarks: evaluateBenchmarks(
      { gpr: wf.gpr, lossToLease: wf.lossToLease, physicalOccupancy: occupancy.rate, economicOccupancy: wf.economicOccupancy },
      settings.benchmarks,
    ),
    late: lateMonths(alloc, policy, s.asOf),
    rentRoll,
  };
}
