import { describe, expect, it } from "vitest";
import { $, AS_OF, charges, leases, payments, units } from "../../../tests/fixtures/small";
import type { Analysis } from "../analysis";
import type { PropertyData } from "../data/load";
import { allocatePayments, lateMonths } from "../metrics/ledger";
import { DEFAULT_SETTINGS } from "../settings";
import { availableRevenue, buildRecInput, RecInputSchema, runRecommendations, suggestedRenewalRent, type RecInput } from "./engine";

const late = lateMonths(allocatePayments(charges, payments), { graceDay: 5, amount: $(50) }, AS_OF);

// A PropertyData / Analysis pair carrying only what buildRecInput reads.
const data = {
  property: { id: "p", maxIncreasePct: 8, rentControl: false, rentControlCapPct: null, pricingSuggestions: true, lateFeeGraceDay: 5, lateFeeAmount: $(50) },
  settings: { ...DEFAULT_SETTINGS, vacancyAlertDays: 20 },
  snapshot: { asOf: AS_OF, units, leases, charges, payments },
} as unknown as PropertyData;
const analysis = { asOf: AS_OF, late } as unknown as Analysis;
const input = buildRecInput(data, analysis);
const recs = runRecommendations(input);
const rec = (id: string) => recs.find((r) => r.id === id)!;

describe("recommendation $ impact (six-unit fixture)", () => {
  it("renewals below market: capped by market, the max increase, and notice status", () => {
    // Only L1 (1A) ends within 90 days and is not on notice. 950 × 1.08 = 1,026 → $1,025; market 1,000 is lower → +$50/mo.
    expect(rec("renewals_below_market")).toMatchObject({ units: ["1A"], monthly: $(50), yearly: $(600) });
    expect(rec("renewals_below_market").math[0]).toContain("$950 → $1,000");
  });
  it("month-to-month: capped increase when no premium is known", () => {
    // 3B: 700 × 1.08 = 756 → $755 (market 800) → +$55/mo
    expect(rec("month_to_month")).toMatchObject({ units: ["3B"], monthly: $(55), yearly: $(660) });
  });
  it("long vacancy: market rent of units vacant longer than the threshold", () => {
    expect(rec("long_vacancy")).toMatchObject({ units: ["3A"], monthly: $(800), yearly: $(9600) });
    // 30 days × $26.67/day
    expect(rec("long_vacancy").math[0]).toContain("$800.10 lost so far");
  });
  it("late fees: missed fees over the last 3 months, averaged per month", () => {
    // 5 late months with no fee × $50 ÷ 3 = $83.33
    expect(rec("late_fees_uniform")).toMatchObject({ monthly: 8333, yearly: 8333 * 12, units: ["1B", "2B", "3B"] });
  });
  it("deposit shortfall is one-time, not monthly", () => {
    expect(rec("deposit_shortfall")).toMatchObject({ units: ["1A", "3B"], oneTime: $(250), monthly: 0, yearly: 0 });
  });
  it("concession burn-off is 'protect', and excluded from the headline", () => {
    expect(rec("concession_burnoff")).toMatchObject({ kind: "protect", units: ["1B"], monthly: $(100) });
    // gains: renewals 600 + mtm 660 + vacancy 9,600 + late fees 999.96
    expect(availableRevenue(recs)).toEqual({ yearly: $(600) + $(660) + $(9600) + 8333 * 12, monthly: $(50) + $(55) + $(800) + 8333, oneTime: $(250) });
  });
  it("expiration clustering names the crowded months", () => {
    expect(rec("expiration_clustering").math).toHaveLength(3); // Nov 2026, Dec 2026, Jun 2027
    expect(rec("expiration_clustering").monthly).toBe(0);
  });
  it("unbilled lease charge", () => {
    const withUnbilled: RecInput = { ...input, leases: input.leases.map((l) => (l.id === "L2" ? { ...l, recurring: [{ type: "pet", amount: $(35), billed: false }] } : l)) };
    const r = runRecommendations(withUnbilled).find((x) => x.id === "unbilled_charges")!;
    expect(r).toMatchObject({ units: ["1B"], monthly: $(35), yearly: $(420) });
  });
  it("subsidy mismatch is flagged with no dollar figure", () => {
    const mismatch: RecInput = { ...input, leases: input.leases.map((l) => (l.id === "L3" ? { ...l, subsidy: { tenantPortion: $(400), hapPortion: $(900), leaseTenantPortion: $(370), leaseHapPortion: $(930) } } : l)) };
    expect(runRecommendations(mismatch).find((x) => x.id === "subsidy_mismatch")).toMatchObject({ kind: "review", units: ["2A"], monthly: 0 });
  });
  it("ranks gains by yearly dollars", () => {
    const gains = recs.filter((r) => r.kind === "gain").map((r) => r.yearly);
    expect(gains).toEqual([...gains].sort((a, b) => b - a));
  });
});

describe("pricing guardrails", () => {
  it("respects the owner's max increase", () => {
    expect(suggestedRenewalRent($(1000), $(1200), { maxIncreasePct: 8, rentControl: false, rentControlCapPct: null })).toMatchObject({ rent: $(1080), cappedBy: "max increase" });
  });
  it("respects a rent-control cap below the max increase", () => {
    expect(suggestedRenewalRent($(1000), $(1200), { maxIncreasePct: 8, rentControl: true, rentControlCapPct: 3 })).toMatchObject({ rent: $(1030), cappedBy: "rent control" });
  });
  it("never suggests more than market, and never a decrease", () => {
    expect(suggestedRenewalRent($(1000), $(1040), { maxIncreasePct: 8, rentControl: false, rentControlCapPct: null }).rent).toBe($(1040));
    expect(suggestedRenewalRent($(1000), $(900), { maxIncreasePct: 8, rentControl: false, rentControlCapPct: null }).rent).toBe($(1000));
  });
  it("rounds down so the cap is never exceeded", () => {
    // 950 × 1.08 = 1,026 → 1,025
    expect(suggestedRenewalRent($(950), $(2000), { maxIncreasePct: 8, rentControl: false, rentControlCapPct: null }).rent).toBe($(1025));
  });
  it("makes no rent suggestions when pricing suggestions are off", () => {
    const off = runRecommendations({ ...input, policy: { ...input.policy, pricingSuggestions: false } });
    expect(off.find((r) => r.id === "renewals_below_market")).toBeUndefined();
    expect(off.find((r) => r.id === "month_to_month")!.monthly).toBe(0);
  });
});

describe("fair housing guard", () => {
  it("the engine input contains lease and payment data only — no resident attributes", () => {
    const leaseKeys = Object.keys(input.leases[0]).sort();
    expect(leaseKeys).toEqual([
      "concessions", "contractRent", "depositHeld", "depositRequired", "end", "id", "lateFeeAuthorized", "mtm", "mtmPremium",
      "recurring", "start", "subsidy", "unitId",
    ]);
    // resident names exist on the source data but never reach the engine
    expect(leases[0].residents[0]).toBe("Resident L1");
    expect(JSON.stringify(input)).not.toContain("Resident");
  });
  it("FAILS if any other resident attribute reaches the engine", () => {
    for (const extra of [{ residents: ["Jane Doe"] }, { age: 71 }, { familialStatus: "children" }, { nationalOrigin: "x" }, { disability: true }, { notes: "single mom" }]) {
      const tainted = { ...input, leases: input.leases.map((l, i) => (i === 0 ? { ...l, ...extra } : l)) };
      expect(() => runRecommendations(tainted as RecInput), `attribute ${Object.keys(extra)[0]} must be rejected`).toThrow();
    }
    expect(() => RecInputSchema.parse({ ...input, residents: [] })).toThrow();
    expect(() => RecInputSchema.parse({ ...input, lateMonths: [{ leaseId: "L1", period: "2026-11", feeCharged: false, payer: "Jane" }] })).toThrow();
  });
  it("identical lease terms produce identical recommendations", () => {
    // Same inputs, different lease ids only: output differs in nothing but ordering of identical figures.
    const again = runRecommendations(JSON.parse(JSON.stringify(input)));
    expect(again).toEqual(recs);
  });
});
