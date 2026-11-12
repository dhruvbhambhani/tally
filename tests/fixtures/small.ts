/**
 * A six-unit building small enough to check every number by hand.
 * All expected values in the tests are worked out in the comments beside them.
 *
 *  Unit  Type    Market  Status    Lease  Rent   Notes
 *  1A    1BR     $1,000  occupied  L1     $950   +$25 pet (billed); deposit $900 of $950
 *  1B    1BR     $1,000  occupied  L2     $1,000 $100/mo concession through Nov 30, 2026
 *  2A    2BR     $1,400  occupied  L3     $1,300 voucher: tenant $400 + HAP $900
 *  2B    2BR     $1,400  notice    L4     $1,400 lease ends Nov 30, 2026; has not paid Oct or Nov
 *  3A    Studio  $800    vacant    —      —      vacant since Oct 11, 2026
 *  3B    Studio  $800    occupied  L5     $700   month-to-month; deposit $500 of $700
 *
 *  As of Nov 10, 2026. Ledger covers October and November 2026.
 */
import type { Lease, Payment, Snapshot, Unit } from "@/lib/domain/types";
import { chargesForMonth } from "@/lib/metrics/rentroll";

const $ = (dollars: number) => dollars * 100;

export const AS_OF = "2026-11-10";

export const units: Unit[] = [
  { id: "1A", number: "1A", unitType: "1BR", beds: 1, baths: 1, sqft: 600, status: "occupied", marketRent: $(1000), vacantSince: null },
  { id: "1B", number: "1B", unitType: "1BR", beds: 1, baths: 1, sqft: 620, status: "occupied", marketRent: $(1000), vacantSince: null },
  { id: "2A", number: "2A", unitType: "2BR", beds: 2, baths: 1, sqft: 850, status: "occupied", marketRent: $(1400), vacantSince: null },
  { id: "2B", number: "2B", unitType: "2BR", beds: 2, baths: 1, sqft: 850, status: "notice", marketRent: $(1400), vacantSince: null },
  { id: "3A", number: "3A", unitType: "Studio", beds: 0, baths: 1, sqft: 400, status: "vacant", marketRent: $(800), vacantSince: "2026-10-11" },
  { id: "3B", number: "3B", unitType: "Studio", beds: 0, baths: 1, sqft: 420, status: "occupied", marketRent: $(800), vacantSince: null },
];

const lease = (l: Partial<Lease> & Pick<Lease, "id" | "unitId" | "contractRent">): Lease => ({
  residents: [`Resident ${l.id}`], start: "2026-01-01", end: "2027-06-30", mtm: false, recurring: [], concessions: [],
  depositHeld: 0, depositRequired: null, subsidy: null, lateFeeAuthorized: null, mtmPremium: null, ...l,
});

export const leases: Lease[] = [
  lease({ id: "L1", unitId: "1A", contractRent: $(950), end: "2026-12-31", recurring: [{ type: "pet", amount: $(25), billed: true }], depositHeld: $(900), depositRequired: $(950) }),
  lease({ id: "L2", unitId: "1B", contractRent: $(1000), concessions: [{ label: "Move-in special", monthlyAmount: $(100), endsOn: "2026-11-30" }], depositHeld: $(1000) }),
  lease({ id: "L3", unitId: "2A", contractRent: $(1300), subsidy: { tenantPortion: $(400), hapPortion: $(900), leaseTenantPortion: null, leaseHapPortion: null }, depositHeld: $(1300), depositRequired: $(1300) }),
  lease({ id: "L4", unitId: "2B", contractRent: $(1400), end: "2026-11-30", depositHeld: $(1400) }),
  lease({ id: "L5", unitId: "3B", contractRent: $(700), end: null, mtm: true, start: "2024-03-01", depositHeld: $(500), depositRequired: $(700) }),
];

export const charges = leases.flatMap((l) => [...chargesForMonth(l, "2026-10"), ...chargesForMonth(l, "2026-11")]);

const pay = (id: string, leaseId: string, dollars: number, date: string, payerType: Payment["payerType"] = "tenant"): Payment => ({
  id, leaseId, amount: $(dollars), date, payer: "", memo: "", method: "bank", payerType,
});

export const payments: Payment[] = [
  pay("p1", "L1", 975, "2026-10-01"),
  pay("p2", "L1", 975, "2026-11-03"),
  pay("p3", "L2", 900, "2026-10-08"), // late: after the 5th
  pay("p4", "L2", 500, "2026-11-02"), // partial: $900 due
  pay("p5", "L3", 400, "2026-10-01"),
  pay("p6", "L3", 400, "2026-11-01"),
  pay("p7", "L3", 900, "2026-10-03", "subsidy"),
  pay("p8", "L3", 900, "2026-11-04", "subsidy"),
  pay("p9", "L5", 700, "2026-10-05"),
  pay("p10", "L5", 700, "2026-11-06"), // late: after the 5th
];

export const snapshot: Snapshot = { asOf: AS_OF, units, leases, charges, payments };
export { $ };
