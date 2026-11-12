import { describe, expect, it } from "vitest";
import { $, AS_OF, charges, payments } from "../../../tests/fixtures/small";
import { figuresAreGrounded } from "../ai/provider";
import type { Charge } from "../domain/types";
import { aging, allocatePayments } from "../metrics/ledger";
import { DEFAULT_LADDER, DEFAULT_SETTINGS } from "../settings";
import { paymentPlan, suggestedStep, templateLetter, type LetterInput } from "./letters";
import { availableNotices, buildFormalNotice, checkNoticePeriod, loadNoticeConfig, type FormalNoticeInput } from "./notices";

// L4 (unit 2B) owes Oct + Nov rent = $2,800; add a $50 late fee charged in October.
const lateFee: Charge = { id: "L4:2026-10:late_fee", leaseId: "L4", type: "late_fee", amount: $(50), dueDate: "2026-10-06", period: "2026-10", payer: "tenant" };
const report = aging(allocatePayments([...charges, lateFee], payments), AS_OF);
const l4 = report.byLease.find((l) => l.leaseId === "L4")!;

const noticeInput = (over: Partial<FormalNoticeInput> = {}): FormalNoticeInput => ({
  state: "TX", type: "notice_to_vacate", cares: "no", asOf: AS_OF,
  property: { name: "Test Court", address: "1 Test St", city: "Austin", state: "TX" },
  unitNumber: "2B", residents: ["Resident L4"], aging: l4, lateFeeAuthorized: null, ownerName: "Owner",
  assistanceText: DEFAULT_SETTINGS.rentalAssistanceText, ...over,
});

describe("CARES Act / notice-period guard", () => {
  it("not covered: the configured period stands", () => {
    expect(checkNoticePeriod(3, "no")).toEqual({ days: 3, blocked: false, explanation: null, needsConfirmation: false });
  });
  it("covered: a notice shorter than 30 days is blocked and 30 days is used, with one sentence why", () => {
    const c = checkNoticePeriod(3, "yes");
    expect(c).toMatchObject({ days: 30, blocked: true, needsConfirmation: false });
    expect(c.explanation).toMatch(/CARES Act/);
    expect(c.explanation!.split(". ").length).toBe(1);
  });
  it("unknown is treated as covered, and the owner is asked to confirm", () => {
    const c = checkNoticePeriod(3, "unknown");
    expect(c).toMatchObject({ days: 30, blocked: true, needsConfirmation: true });
    expect(c.explanation).toMatch(/federally backed mortgage or a federal subsidy/);
  });
  it("a configured period of 30+ days is never blocked", () => {
    expect(checkNoticePeriod(30, "yes").blocked).toBe(false);
    expect(checkNoticePeriod(60, "unknown")).toMatchObject({ days: 60, blocked: false });
  });
  it("no formal notice for nonpayment can be produced with fewer than 30 days when covered or unknown", () => {
    for (const cares of ["yes", "unknown"] as const) {
      for (const state of ["TX", "CA", "NY"]) {
        for (const n of availableNotices(state)) {
          const notice = buildFormalNotice(noticeInput({ state, type: n.type, cares }));
          expect(notice.days).toBeGreaterThanOrEqual(30);
          expect(notice.text).toMatch(/within 30 days|Within 30 days/);
        }
      }
    }
    expect(buildFormalNotice(noticeInput({ cares: "no" })).days).toBe(3);
  });
  it("notice periods come from config, not code", () => {
    const cfg = loadNoticeConfig();
    expect(cfg.caresMinimumDays).toBe(30);
    expect(availableNotices("TX")[0]).toMatchObject({ type: "notice_to_vacate", days: cfg.states.TX.notice_to_vacate!.days, templateState: "TX" });
    expect(availableNotices("NY").every((n) => n.templateState === "DEFAULT")).toBe(true); // falls back to generic templates
  });
});

describe("formal notices", () => {
  it("are marked SAMPLE and merged with ledger data", () => {
    const n = buildFormalNotice(noticeInput());
    expect(n.text).toContain("SAMPLE — have your attorney review before use.");
    expect(n.text).toContain("Unit 2B, Test Court, 1 Test St, Austin, TX");
    expect(n.text).not.toMatch(/\{\{\w+\}\}/);
  });
  it("leave out late fees when no lease on file authorizes them", () => {
    const n = buildFormalNotice(noticeInput({ lateFeeAuthorized: null }));
    expect(n.amount).toBe($(2800));
    expect(n.excludedLateFees).toBe($(50));
    expect(n.text).not.toContain("Late fee");
    expect(buildFormalNotice(noticeInput({ lateFeeAuthorized: false })).amount).toBe($(2800));
  });
  it("include late fees only when the lease authorizes them", () => {
    const n = buildFormalNotice(noticeInput({ lateFeeAuthorized: true }));
    expect(n.amount).toBe($(2850));
    expect(n.excludedLateFees).toBe(0);
    expect(n.text).toContain("Late fee");
  });
});

describe("payment plan", () => {
  it("always adds up to the balance exactly", () => {
    const plan = paymentPlan($(1000), 3, "2026-11-10");
    // 1,000 ÷ 3 = 333.33 with 1¢ left over → first installment
    expect(plan).toEqual([
      { due: "2026-11-15", amount: 33334 }, { due: "2026-12-15", amount: 33333 }, { due: "2027-01-15", amount: 33333 },
    ]);
    expect(plan.reduce((t, p) => t + p.amount, 0)).toBe($(1000));
  });
  it("starts next month when the 15th has passed", () => {
    expect(paymentPlan($(900), 2, "2026-11-20").map((p) => p.due)).toEqual(["2026-12-15", "2027-01-15"]);
  });
});

describe("ladder", () => {
  it("suggests the furthest step reached", () => {
    expect(suggestedStep(0, DEFAULT_LADDER)).toBeNull();
    expect(suggestedStep(9, DEFAULT_LADDER)!.key).toBe("friendly_reminder");
    expect(suggestedStep(40, DEFAULT_LADDER)!.key).toBe("payment_plan");
    expect(suggestedStep(70, DEFAULT_LADDER)!.key).toBe("formal_notice");
    expect(suggestedStep(101, DEFAULT_LADDER)!.key).toBe("attorney");
  });
  it("formal steps require approval", () => {
    expect(DEFAULT_LADDER.filter((s) => s.requiresApproval).map((s) => s.key)).toEqual(["formal_notice", "attorney"]);
  });
});

describe("friendly letters", () => {
  const input = (over: Partial<LetterInput> = {}): LetterInput => ({
    type: "friendly_reminder", channel: "letter", language: "en", asOf: AS_OF, propertyName: "Test Court", ownerName: "Owner",
    unitNumber: "2B", residents: ["Dana Reyes", "Sam Reyes"], aging: l4, lastPayment: null, planMonths: 3,
    assistanceText: DEFAULT_SETTINGS.rentalAssistanceText, ...over,
  });
  it("use the resident's actual ledger and include the rental-assistance line", () => {
    const l = templateLetter(input());
    expect(l.body).toContain("Hi Dana and Sam,");
    expect(l.body).toContain("$2,850.00");
    expect(l.body).toContain("October 2026 rent: $1,400.00");
    expect(l.body).toContain(DEFAULT_SETTINGS.rentalAssistanceText);
    expect(l.amount).toBe($(2850));
  });
  it("Spanish version carries the same figures", () => {
    const l = templateLetter(input({ language: "es", assistanceText: DEFAULT_SETTINGS.rentalAssistanceTextEs }));
    expect(l.body).toContain("Hola Dana y Sam:");
    expect(l.body).toContain("$2,850.00");
    expect(l.body).toContain("octubre de 2026 renta: $1,400.00");
  });
  it("payment-plan offer lists a schedule that sums to the balance", () => {
    const l = templateLetter(input({ type: "payment_plan" }));
    expect(l.plan.reduce((t, p) => t + p.amount, 0)).toBe($(2850));
    expect(l.body).toContain("November 15, 2026: $950.00");
  });
  it("every figure in every template is one of the computed facts", () => {
    for (const type of ["friendly_reminder", "second_reminder", "payment_plan"] as const) {
      for (const channel of ["letter", "sms"] as const) {
        const l = templateLetter(input({ type, channel }));
        expect(figuresAreGrounded(l.body, l.facts), `${type}/${channel}`).toBe(true);
      }
    }
  });
  it("rejects generated text that changes or invents a dollar amount", () => {
    const l = templateLetter(input());
    expect(figuresAreGrounded(l.body.replace("$2,850.00", "$2,580.00"), l.facts)).toBe(false);
    expect(figuresAreGrounded(l.body + " A $75 fee applies.", l.facts)).toBe(false);
  });
});
