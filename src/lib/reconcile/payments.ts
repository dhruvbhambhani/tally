/**
 * Payment matching: tie bank / payment-app deposits to leases using the payer
 * name, a unit number in the memo, and the amount. Deterministic and explainable:
 * every match carries the reasons it was made. Weak or ambiguous evidence is
 * left unmatched for the owner — never guessed.
 */
import type { Cents, ISODate, PayerType } from "../domain/types";
import { bestNameMatch } from "./names";

export interface DepositInput {
  id: string;
  date: ISODate;
  amount: Cents;
  payer: string;
  memo: string;
  description: string;
}

export interface LeaseTarget {
  leaseId: string;
  unitNumber: string;
  residents: string[];
  /** what the tenant is billed each month (rent share + extras − concession) */
  expectedTenant: Cents;
  /** voucher share, when there is one */
  expectedSubsidy: Cents | null;
  /** everything the tenant currently owes */
  openBalance: Cents;
}

export interface DepositMatch {
  depositId: string;
  leaseId: string | null;
  payerType: PayerType;
  /** 0–1 */
  confidence: number;
  reasons: string[];
  /** paid less than the monthly charge (and not one roommate's half) */
  partial: boolean;
  /** why it was left unmatched, in plain English */
  unmatchedReason?: string;
}

export const MATCH_THRESHOLD = 0.55;
const MARGIN = 0.15;

const SUBSIDY_RE = /\bHAP\b|HOUSING AUTH|SECTION 8|\bPHA\b|VOUCHER/i;

/** Unit numbers mentioned after "apt", "unit", "#", or standing alone in the memo. */
export function unitsMentioned(text: string, unitNumbers: Set<string>): string[] {
  const out = new Set<string>();
  for (const m of text.toUpperCase().matchAll(/(?:\b(?:APT|UNIT|STE|RM)\.?\s*#?\s*|#\s*)([A-Z0-9-]{1,6})\b/g)) {
    if (unitNumbers.has(m[1])) out.add(m[1]);
  }
  for (const tok of text.toUpperCase().split(/[^A-Z0-9-]+/)) {
    if (unitNumbers.has(tok) && /\d/.test(tok)) out.add(tok);
  }
  return [...out];
}

export function matchDeposits(deposits: DepositInput[], targets: LeaseTarget[]): DepositMatch[] {
  const unitNumbers = new Set(targets.map((t) => t.unitNumber.toUpperCase()));
  return deposits.map((d) => {
    const isSubsidy = SUBSIDY_RE.test(d.description) || SUBSIDY_RE.test(d.memo);
    // Only the memo is searched for unit numbers: descriptions carry check and branch numbers.
    const mentioned = unitsMentioned(d.memo, unitNumbers);
    const scored = targets
      .map((t) => {
        let score = 0;
        const reasons: string[] = [];
        if (isSubsidy && t.expectedSubsidy == null) return { t, score: 0, reasons };
        if (mentioned.includes(t.unitNumber.toUpperCase())) {
          score += 0.55;
          reasons.push(`memo mentions unit ${t.unitNumber}`);
        }
        if (!isSubsidy && d.payer) {
          const nm = bestNameMatch(d.payer, t.residents);
          if (nm.score >= 0.85) {
            score += 0.6;
            reasons.push(nm.score === 1 ? `payer name is ${nm.resident}` : `payer "${d.payer}" matches ${nm.resident}`);
          } else if (nm.score >= 0.7) {
            score += 0.35;
            reasons.push(`payer "${d.payer}" is close to ${nm.resident}`);
          }
        }
        if (score > 0) {
          const expected = isSubsidy ? t.expectedSubsidy : t.expectedTenant;
          const half = t.residents.length > 1 && !isSubsidy && d.amount * 2 === t.expectedTenant;
          if (d.amount === expected) {
            score += 0.2;
            reasons.push(isSubsidy ? "amount equals the voucher portion" : "amount equals the monthly charge");
          } else if (half) {
            score += 0.15;
            reasons.push("amount is half the monthly charge (roommates)");
          } else if (!isSubsidy && d.amount === t.openBalance) {
            score += 0.15;
            reasons.push("amount equals the balance owed");
          }
        }
        return { t, score, reasons };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score);

    const payerType: PayerType = isSubsidy ? "subsidy" : "tenant";
    const best = scored[0];
    if (!best || best.score < MATCH_THRESHOLD) {
      const why = !d.payer && !mentioned.length
        ? "No payer name or unit number on this deposit."
        : best
          ? `Closest is unit ${best.t.unitNumber}, but the evidence is too weak to be sure.`
          : `Nobody on the rent roll matches "${d.payer || d.memo}".`;
      return { depositId: d.id, leaseId: null, payerType, confidence: 0, reasons: [], partial: false, unmatchedReason: why };
    }
    const second = scored[1];
    if (second && best.score - second.score < MARGIN) {
      return {
        depositId: d.id, leaseId: null, payerType, confidence: 0, reasons: [], partial: false,
        unmatchedReason: `Could be unit ${best.t.unitNumber} or unit ${second.t.unitNumber} — Tally won't guess.`,
      };
    }
    const t = best.t;
    const isHalf = t.residents.length > 1 && d.amount * 2 === t.expectedTenant;
    const partial = payerType === "tenant" && d.amount < t.expectedTenant && !isHalf;
    return { depositId: d.id, leaseId: t.leaseId, payerType, confidence: Math.min(1, best.score), reasons: best.reasons, partial };
  });
}
