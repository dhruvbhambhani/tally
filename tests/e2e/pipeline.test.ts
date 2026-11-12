/**
 * End to end: import the Maple Court sample files through the real pipeline
 * (demo AI provider, temporary SQLite database) and check what comes out.
 *
 * Expected figures are worked out by hand from the story in
 * scripts/sample/truth.ts — see the comments beside each one.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { analyze, type Analysis } from "@/lib/analysis";
import { dataHealth, loadProperty, type PropertyData } from "@/lib/data/load";
import { importSampleData, SAMPLE_PROPERTY_ID } from "@/lib/data/sample";
import { openDb, type DB } from "@/lib/db/client";
import { conflicts, stagedRows } from "@/lib/db/schema";

const $ = (d: number) => Math.round(d * 100);
let db: DB;
let data: PropertyData;
let a: Analysis;
let imported: Awaited<ReturnType<typeof importSampleData>>;

beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tally-e2e-"));
  process.env.TALLY_DATA_DIR = dir;
  process.env.TALLY_AI_PROVIDER = "demo";
  db = openDb(path.join(dir, "test.db"));
  imported = await importSampleData(db);
  data = loadProperty(db, SAMPLE_PROPERTY_ID)!;
  a = analyze(data);
});

describe("import", () => {
  it("detects every file type", () => {
    const kinds = Object.fromEntries(imported.files.map((f) => [f.name, f.kind]));
    expect(kinds["appfolio_rent_roll_2026-11-10.csv"]).toBe("pms_rent_roll");
    expect(kinds["maple_ct_tracker.xlsx"]).toBe("spreadsheet");
    expect(kinds["bank_statement_nov_2026.csv"]).toBe("bank");
    expect(kinds["lease_unit_306.pdf"]).toBe("lease");
    expect(kinds["ledger_page_1.jpg"]).toBe("ledger_image");
    expect(imported.files).toHaveLength(10);
  });
  it("reads 46 bank deposits", () => {
    expect(imported.files.find((f) => f.kind === "bank")!.rows).toBe(46);
  });
  it("fills in the property from the rent roll header", () => {
    expect(data.property).toMatchObject({ name: "Maple Court", city: "Austin", state: "TX", unitCount: 48, asOf: "2026-11-10" });
  });
  it("puts the seeded problems in the review queue", () => {
    const review = db.select().from(stagedRows).all().filter((r) => r.status === "needs_review").map((r) => r.reviewReason!);
    expect(review.some((r) => /06\/31\/2027.*isn't a real date/.test(r))).toBe(true); // rent-roll error 1
    expect(review.some((r) => /Unit 207 appears twice/.test(r))).toBe(true); // rent-roll error 2
    expect(review.some((r) => /Hard to read: amount/.test(r))).toBe(true); // handwriting
    expect(review.some((r) => /Hard to read: name/.test(r))).toBe(true);
    expect(review).toHaveLength(4);
  });
  it("flags the lease-vs-rent-roll rent conflict and does not resolve it", () => {
    const open = db.select().from(conflicts).all().filter((c) => c.status === "open");
    expect(open).toHaveLength(1); // rent-roll error 3
    expect(open[0]).toMatchObject({ unitNumber: "306", field: "rent", workingValue: String($(1400)) });
    expect(open[0].candidates.map((c) => c.value).sort()).toEqual([$(1400), $(1400), $(1450)]);
  });
});

describe("rent roll totals", () => {
  it("48 units, 45 occupied", () => {
    expect(a.rentRoll).toHaveLength(48);
    expect(a.occupancy).toMatchObject({ occupied: 45, total: 48 });
    expect(a.occupancy.rate).toBeCloseTo(0.9375, 6);
  });
  it("waterfall from possible rent to collected", () => {
    // GPR: 20×1,250 + 16×1,550 + 8×1,700 + 4×995
    expect(a.waterfall.gpr).toBe($(67380));
    // Vacant: 204 (1,250) + 307 (1,550) + 411 (1,700)
    expect(a.waterfall.vacancy).toBe($(4500));
    // Sum of (market − contract) over the 45 leases: 1BR 700 + 2BR/1BA 675 + 2BR/2BA 300 + studio 140
    expect(a.waterfall.lossToLease).toBe($(1815));
    // 105: $200, 209: $100
    expect(a.waterfall.concessions).toBe($(300));
    // Nov rent unpaid: 208 700 + 103 1,200 + 310 1,650 + 412 950
    expect(a.waterfall.unpaid).toBe($(4500));
    expect(a.waterfall.other).toBe(0);
    // 67,380 − 4,500 − 1,815 − 300 − 4,500
    expect(a.waterfall.collected).toBe($(56265));
    expect(a.waterfall.economicOccupancy).toBeCloseTo(56265 / 67380, 6);
  });
  it("other income", () => {
    // pets 7×35 + parking 10×50 + storage 3×25 + utilities 6×40
    expect(a.otherIncome.total).toBe($(1060));
  });
  it("month-to-month and renewals", () => {
    expect(a.mtm.map((l) => data.unitNumberOf(l.id)).sort()).toEqual(["211", "302", "405"]);
    expect(a.renewals.d90.map((l) => data.unitNumberOf(l.id)).sort()).toEqual(["101", "202", "206", "303", "309", "312", "410"]);
  });
  it("June expiration cluster is flagged", () => {
    const june = a.expirations.find((m) => m.period === "2027-06")!;
    expect(june.count).toBe(9);
    expect(june.flagged).toBe(true);
    expect(a.expirations.filter((m) => m.flagged).map((m) => m.period)).toEqual(["2027-06"]);
  });
  it("vacant units and days vacant", () => {
    expect(a.vacancy.units.map((u) => u.days).sort((x, y) => x - y)).toEqual([12, 47, 83]);
  });
});

describe("payments", () => {
  it("matches 44 of 46 deposits; 2 are left unmatched", () => {
    const bank = data.paymentRows.filter((p) => p.stagedRowId && /bank|:/.test(p.id) && p.date >= "2026-11-01" && p.method !== "Cash" && p.method !== "Money order");
    expect(bank).toHaveLength(46);
    expect(data.unmatched).toHaveLength(2);
    expect(data.unmatched.map((p) => p.amount).sort((x, y) => x - y)).toEqual([$(600), $(1425)]);
  });
  it("finds the one partial payment", () => {
    const partial = data.paymentRows.filter((p) => /partial payment/.test(p.matchReason));
    expect(partial).toHaveLength(1);
    expect(data.unitNumberOf(partial[0].leaseId!)).toBe("208");
  });
  it("recognizes receipt-book entries already in the payment log", () => {
    expect(imported.build.corroborated).toBe(6);
  });
});

describe("delinquency", () => {
  it("finds 4 delinquent residents across buckets", () => {
    const rows = a.aging.byLease.map((l) => ({ unit: data.unitNumberOf(l.leaseId), balance: l.balance, bucket: l.oldestBucket }));
    expect(rows).toEqual([
      { unit: "310", balance: $(4450), bucket: "61-90" }, // Sep 1,150 + Oct 1,650 + Nov 1,650
      { unit: "412", balance: $(3800), bucket: "90+" }, // Aug–Nov at 950 (Aug payment covered July)
      { unit: "103", balance: $(1850), bucket: "31-60" }, // Oct 600 + $50 late fee + Nov 1,200
      { unit: "208", balance: $(700), bucket: "1-30" }, // Nov 1,500 − 800 paid
    ]);
    expect(a.aging.total).toBe($(10800));
  });
  it("aging buckets", () => {
    // 1–30: Nov charges 700 + 1,200 + 1,650 + 950 = 4,500
    // 31–60: Oct charges 600 + 50 + 1,650 + 950 = 3,250
    // 61–90: Sep charges 1,150 + 950 = 2,100
    // 90+:   Aug charge 950
    expect(a.aging.totals).toEqual({ current: 0, "1-30": $(4500), "31-60": $(3250), "61-90": $(2100), "90+": $(950) });
  });
});

describe("data health", () => {
  it("counts conflicts, unmatched deposits and review items", () => {
    const h = dataHealth(db, SAMPLE_PROPERTY_ID);
    expect(h).toMatchObject({ openConflicts: 1, unmatchedDeposits: 2, reviewItems: 4, files: 10 });
    expect(h.verifiedShare).toBeGreaterThan(0.3);
    expect(h.score).toBeGreaterThan(80);
  });
});
