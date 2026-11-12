import { describe, expect, it } from "vitest";
import { nameSimilarity } from "./names";
import { matchDeposits, unitsMentioned, type DepositInput, type LeaseTarget } from "./payments";

const targets: LeaseTarget[] = [
  { leaseId: "L4B", unitNumber: "4B", residents: ["John Smith"], expectedTenant: 145000, expectedSubsidy: null, openBalance: 145000 },
  { leaseId: "L2A", unitNumber: "2A", residents: ["Maria Gonzalez", "Luis Gonzalez"], expectedTenant: 160000, expectedSubsidy: null, openBalance: 160000 },
  { leaseId: "L3C", unitNumber: "3C", residents: ["Jane Smith"], expectedTenant: 120000, expectedSubsidy: null, openBalance: 120000 },
  { leaseId: "L1A", unitNumber: "1A", residents: ["Ruth Okoye"], expectedTenant: 40000, expectedSubsidy: 90000, openBalance: 40000 },
];
const dep = (id: string, amount: number, payer: string, memo = "", description = ""): DepositInput => ({
  id, date: "2026-11-02", amount, payer, memo, description: description || `ZELLE PAYMENT FROM ${payer}`,
});
const one = (d: DepositInput) => matchDeposits([d], targets)[0];

describe("entity resolution", () => {
  it('"J. Smith" is the same resident as "John Smith"', () => {
    expect(nameSimilarity("J. Smith", "John Smith")).toBeGreaterThanOrEqual(0.85);
    expect(nameSimilarity("JOHN SMITH", "John Smith")).toBe(1);
    expect(nameSimilarity("Mei-Ling Zhou", "MEILING ZHOU")).toBe(1);
  });
  it("same last name, different first name is not the same person", () => {
    expect(nameSimilarity("Jane Smith", "John Smith")).toBeLessThan(0.7);
  });
  it("different people score low", () => {
    expect(nameSimilarity("R Marsh", "Marcus Bell")).toBeLessThan(0.7);
  });
});

describe("payment matching", () => {
  it("matches on exact payer name and amount", () => {
    const m = one(dep("d1", 160000, "MARIA GONZALEZ"));
    expect(m.leaseId).toBe("L2A");
    expect(m.confidence).toBeGreaterThanOrEqual(0.8);
    expect(m.reasons.join(" ")).toMatch(/payer name/);
    expect(m.partial).toBe(false);
  });
  it("matches a unit number in the memo with no name at all", () => {
    const m = one(dep("d2", 145000, "", "CK 1042 APT 4B", "MOBILE CHECK DEPOSIT"));
    expect(m.leaseId).toBe("L4B");
    expect(m.reasons[0]).toMatch(/unit 4B/);
  });
  it("uses the amount or the memo to tell J Smith in 4B from Jane Smith in 3C", () => {
    expect(one(dep("d3", 145000, "J SMITH")).leaseId).toBe("L4B"); // amount equals 4B's charge
    expect(one(dep("d3b", 120000, "J SMITH")).leaseId).toBe("L3C"); // amount equals 3C's charge
    expect(one(dep("d4", 50000, "J SMITH", "RENT 4B")).leaseId).toBe("L4B"); // memo names the unit
  });
  it("never guesses when two residents fit equally", () => {
    const amb = matchDeposits([dep("d5", 99900, "J SMITH")], targets)[0];
    expect(amb.leaseId).toBeNull();
    expect(amb.unmatchedReason).toMatch(/won't guess/);
  });
  it("flags a partial payment", () => {
    const m = one(dep("d6", 80000, "John Smith", "PARTIAL NOV"));
    expect(m.leaseId).toBe("L4B");
    expect(m.partial).toBe(true);
  });
  it("treats one roommate's half as a full share, not a partial", () => {
    const m = one(dep("d7", 80000, "LUIS GONZALEZ"));
    expect(m.leaseId).toBe("L2A");
    expect(m.partial).toBe(false);
  });
  it("routes housing-authority deposits to the voucher share", () => {
    const m = one(dep("d8", 90000, "", "HAP UNIT 1A NOV", "ACH CREDIT COUNTY HOUSING AUTH HAP"));
    expect(m).toMatchObject({ leaseId: "L1A", payerType: "subsidy" });
  });
  it("leaves unknown payers and bare deposits unmatched, with a reason", () => {
    const a = one(dep("d9", 60000, "R MARSH"));
    expect(a.leaseId).toBeNull();
    expect(a.unmatchedReason).toMatch(/Nobody on the rent roll/);
    const b = one(dep("d10", 142500, "", "", "MOBILE CHECK DEPOSIT"));
    expect(b.leaseId).toBeNull();
    expect(b.unmatchedReason).toMatch(/No payer name or unit number/);
  });
  it("does not mistake check numbers for unit numbers", () => {
    expect(unitsMentioned("CK 1110 APT 110", new Set(["110", "1110X"]))).toEqual(["110"]);
  });
});
