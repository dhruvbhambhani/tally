import { describe, expect, it } from "vitest";
import { $, AS_OF, charges, leases, payments, units } from "../../../tests/fixtures/small";
import { aging, allocatePayments, bucketFor, collectionForPeriod, collectionTrend, lateMonths, rentForPeriod } from "./ledger";
import {
  chargesForMonth, concessionsForPeriod, daysVacant, deposits, expirationSchedule, grossPotentialRent, lossToLease,
  monthToMonth, otherIncomePerOccupiedUnit, physicalOccupancy, renewalsDue, unitMix, vacancyLoss, waterfall,
} from "./rentroll";
import { evaluateBenchmarks } from "./benchmarks";

const alloc = allocatePayments(charges, payments);

describe("rent potential", () => {
  it("gross potential rent = every unit at market", () => {
    // 1,000 + 1,000 + 1,400 + 1,400 + 800 + 800
    expect(grossPotentialRent(units)).toBe($(6400));
  });
  it("vacancy loss = market rent of units not producing rent", () => {
    expect(vacancyLoss(units)).toBe($(800)); // 3A
  });
  it("loss-to-lease = market − contract over occupied units", () => {
    // 1A 50 + 1B 0 + 2A 100 + 2B 0 + 3B 100
    expect(lossToLease(units, leases)).toBe($(250));
  });
  it("concessions for the month", () => {
    expect(concessionsForPeriod(charges, "2026-11")).toBe($(100));
  });
});

describe("occupancy", () => {
  it("physical occupancy counts occupied and on-notice units", () => {
    const o = physicalOccupancy(units);
    expect(o.occupied).toBe(5);
    expect(o.rate).toBeCloseTo(5 / 6, 10);
  });
  it("waterfall reconciles from GPR to collected", () => {
    const w = waterfall(units, leases, charges, alloc, "2026-11");
    // Nov rent collected: L1 950 + L2 500 + L3 400 + HAP 900 + L4 0 + L5 700
    expect(w.collected).toBe($(3450));
    // Billed rent 5,250 − collected 3,450 (L2 owes 400, L4 owes 1,400)
    expect(w.unpaid).toBe($(1800));
    expect(w.other).toBe(0);
    expect(w.gpr - w.vacancy - w.lossToLease - w.concessions - w.other - w.unpaid).toBe(w.collected);
    expect(w.economicOccupancy).toBeCloseTo(3450 / 6400, 10);
    expect(w.steps.map((s) => s.key)).toEqual(["gpr", "vacancy", "lossToLease", "concessions", "unpaid", "collected"]);
  });
});

describe("payment allocation", () => {
  it("applies payments oldest charge first", () => {
    const l4 = alloc.states.filter((s) => s.charge.leaseId === "L4");
    expect(l4.every((s) => s.paid === 0)).toBe(true);
    const l2nov = alloc.states.find((s) => s.charge.id === "L2:2026-11:rent")!;
    expect(l2nov.due).toBe($(900)); // 1,000 − 100 concession
    expect(l2nov.paid).toBe($(500));
    expect(l2nov.open).toBe($(400));
  });
  it("a later payment clears the oldest unpaid month first", () => {
    const l = leases[3]; // L4
    const ch = [...chargesForMonth(l, "2026-10"), ...chargesForMonth(l, "2026-11")];
    const a = allocatePayments(ch, [{ id: "x", leaseId: "L4", amount: $(1400), date: "2026-11-09", payer: "", memo: "", method: "", payerType: "tenant" }]);
    expect(a.states.find((s) => s.charge.period === "2026-10")!.open).toBe(0);
    expect(a.states.find((s) => s.charge.period === "2026-11")!.open).toBe($(1400));
  });
  it("keeps tenant and voucher shares separate", () => {
    const hap = alloc.states.find((s) => s.charge.id === "L3:2026-11:rent-hap")!;
    expect(hap.paid).toBe($(900));
    expect(hap.paidOn).toBe("2026-11-04");
  });
  it("tracks overpayments as unapplied", () => {
    const a = allocatePayments(chargesForMonth(leases[4], "2026-11"), [
      { id: "x", leaseId: "L5", amount: $(800), date: "2026-11-01", payer: "", memo: "", method: "", payerType: "tenant" },
    ]);
    expect(a.unapplied.get("L5")).toBe($(100));
  });
});

describe("delinquency aging", () => {
  it("buckets by days past due", () => {
    expect(bucketFor(0)).toBe("current");
    expect(bucketFor(1)).toBe("1-30");
    expect(bucketFor(30)).toBe("1-30");
    expect(bucketFor(31)).toBe("31-60");
    expect(bucketFor(60)).toBe("31-60");
    expect(bucketFor(61)).toBe("61-90");
    expect(bucketFor(90)).toBe("61-90");
    expect(bucketFor(91)).toBe("90+");
  });
  it("totals by bucket, never one number", () => {
    const r = aging(alloc, AS_OF);
    // Nov charges are 9 days past due: L2 400 + L4 1,400. Oct charge is 40 days: L4 1,400.
    expect(r.totals).toEqual({ current: 0, "1-30": $(1800), "31-60": $(1400), "61-90": 0, "90+": 0 });
    expect(r.total).toBe($(3200));
  });
  it("per resident: balance, oldest bucket, days late", () => {
    const r = aging(alloc, AS_OF);
    expect(r.byLease.map((l) => l.leaseId)).toEqual(["L4", "L2"]);
    expect(r.byLease[0]).toMatchObject({ balance: $(2800), oldestBucket: "31-60", daysLate: 40 });
    expect(r.byLease[1]).toMatchObject({ balance: $(400), oldestBucket: "1-30", daysLate: 9 });
  });
  it("charges not yet due are excluded", () => {
    expect(aging(alloc, "2026-10-31").total).toBe($(1400));
  });
});

describe("collections", () => {
  it("collection rate for the month", () => {
    const c = collectionForPeriod(alloc, "2026-11");
    expect(c.billed).toBe($(5275)); // rent 5,250 + pet 25
    expect(c.collected).toBe($(3475));
    expect(c.rate).toBeCloseTo(3475 / 5275, 10);
  });
  it("trend across months", () => {
    const t = collectionTrend(alloc, ["2026-10", "2026-11"]);
    // Oct: L1 975 + L2 900 + L3 1,300 + L5 700
    expect(t[0].collected).toBe($(3875));
    expect(t[0].billed).toBe($(5275));
  });
  it("rent billed and collected for the month", () => {
    expect(rentForPeriod(alloc, "2026-11")).toEqual({ billed: $(5250), collected: $(3450) });
  });
  it("late months respect the grace day", () => {
    const late = lateMonths(alloc, { graceDay: 5, amount: $(50) }, AS_OF);
    expect(late.map((l) => `${l.leaseId} ${l.period}`)).toEqual(["L2 2026-10", "L4 2026-10", "L2 2026-11", "L4 2026-11", "L5 2026-11"]);
    expect(late.every((l) => !l.feeCharged)).toBe(true);
  });
});

describe("unit mix, expirations, renewals", () => {
  it("unit mix by type", () => {
    const mix = unitMix(units, leases);
    expect(mix.map((m) => m.unitType)).toEqual(["Studio", "1BR", "2BR"]);
    expect(mix[1]).toMatchObject({ count: 2, avgMarketRent: $(1000), avgContractRent: $(975) });
    expect(mix[2]).toMatchObject({ count: 2, avgMarketRent: $(1400), avgContractRent: $(1350) });
    expect(mix[0]).toMatchObject({ count: 2, occupied: 1, avgContractRent: $(700) });
  });
  it("expiration schedule flags months over 10% of units", () => {
    const s = expirationSchedule(leases, units.length, AS_OF, 12, 0.1);
    expect(s).toHaveLength(12);
    expect(s[0]).toMatchObject({ period: "2026-11", count: 1, flagged: true }); // 1 of 6 = 16.7%
    expect(s.find((m) => m.period === "2027-06")).toMatchObject({ count: 2, flagged: true });
    expect(s.find((m) => m.period === "2027-01")).toMatchObject({ count: 0, flagged: false });
  });
  it("month-to-month count", () => {
    expect(monthToMonth(leases).map((l) => l.id)).toEqual(["L5"]);
  });
  it("renewals due exclude units already on notice", () => {
    expect(renewalsDue(leases, units, AS_OF, 30).map((l) => l.id)).toEqual([]);
    expect(renewalsDue(leases, units, AS_OF, 60).map((l) => l.id)).toEqual(["L1"]);
  });
});

describe("other income, deposits, vacancy", () => {
  it("other income per occupied unit", () => {
    expect(otherIncomePerOccupiedUnit(charges, units, "2026-11")).toEqual({ total: $(25), perUnit: $(5) });
  });
  it("deposits held vs required", () => {
    const d = deposits(leases);
    expect(d.held).toBe($(5100));
    expect(d.requiredKnown).toBe($(2950));
    expect(d.shortfalls).toEqual([
      { leaseId: "L1", held: $(900), required: $(950), shortfall: $(50) },
      { leaseId: "L5", held: $(500), required: $(700), shortfall: $(200) },
    ]);
    expect(d.shortfallTotal).toBe($(250));
  });
  it("average days vacant and cost per day", () => {
    const v = daysVacant(units, AS_OF);
    expect(v.avgDays).toBe(30);
    expect(v.units[0].costPerDay).toBe(2667); // $800 / 30
  });
});

describe("benchmarks", () => {
  it("flags values outside the configured range and reports the range used", () => {
    const r = evaluateBenchmarks({ gpr: $(6400), lossToLease: $(250), physicalOccupancy: 5 / 6, economicOccupancy: 3450 / 6400 });
    expect(r[0]).toMatchObject({ key: "lossToLeasePct", value: 3.9, status: "within" });
    expect(r[1]).toMatchObject({ key: "occupancyGapPts", value: 29.4, status: "above" });
    expect(r[1].range.max).toBe(7);
  });
  it("uses the owner's own ranges when provided", () => {
    const src = "Owner setting";
    const r = evaluateBenchmarks(
      { gpr: 100, lossToLease: 4, physicalOccupancy: 1, economicOccupancy: 1 },
      { lossToLeasePct: { min: 0, max: 3, source: src }, occupancyGapPts: { min: 0, max: 5, source: src } },
    );
    expect(r[0].status).toBe("above");
  });
});
