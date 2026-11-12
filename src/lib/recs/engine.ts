/**
 * "Ways to earn more" — a rules engine. Every dollar figure is computed here.
 *
 * FAIR HOUSING: the engine only ever receives lease terms, unit facts and
 * payment timing. `RecInputSchema` is strict: any other attribute (a name, an
 * age, a household detail, a note) makes it throw, and a test enforces that.
 * The same rule is applied to every lease that meets its condition.
 */
import { z } from "zod";
import type { Analysis } from "../analysis";
import type { PropertyData } from "../data/load";
import { addDays, addMonths, daysBetween, formatDate, periodOf } from "../dates";
import type { Cents } from "../domain/types";
import { money } from "../money";

const UnitIn = z.strictObject({
  id: z.string(), number: z.string(), unitType: z.string(),
  status: z.enum(["occupied", "vacant", "notice", "down", "model", "employee"]),
  marketRent: z.number().int(), vacantSince: z.string().nullable(),
});
const LeaseIn = z.strictObject({
  id: z.string(), unitId: z.string(), start: z.string(), end: z.string().nullable(), mtm: z.boolean(),
  contractRent: z.number().int(),
  recurring: z.array(z.strictObject({ type: z.string(), amount: z.number().int(), billed: z.boolean() })),
  concessions: z.array(z.strictObject({ label: z.string(), monthlyAmount: z.number().int(), endsOn: z.string() })),
  depositHeld: z.number().int(), depositRequired: z.number().int().nullable(),
  subsidy: z.strictObject({
    tenantPortion: z.number().int(), hapPortion: z.number().int(),
    leaseTenantPortion: z.number().int().nullable(), leaseHapPortion: z.number().int().nullable(),
  }).nullable(),
  lateFeeAuthorized: z.boolean().nullable(), mtmPremium: z.number().int().nullable(),
});
export const RecInputSchema = z.strictObject({
  propertyId: z.string(),
  asOf: z.string(),
  unitCount: z.number().int(),
  policy: z.strictObject({
    maxIncreasePct: z.number(), rentControl: z.boolean(), rentControlCapPct: z.number().nullable(),
    pricingSuggestions: z.boolean(), lateFeeGraceDay: z.number().int(), lateFeeAmount: z.number().int(),
    vacancyAlertDays: z.number().int(), expirationFlagShare: z.number(),
  }),
  units: z.array(UnitIn),
  leases: z.array(LeaseIn),
  /** payment timing only: which months rent came in after the grace day */
  lateMonths: z.array(z.strictObject({ leaseId: z.string(), period: z.string(), feeCharged: z.boolean() })),
});
export type RecInput = z.infer<typeof RecInputSchema>;

/** The ONLY way data reaches the engine: an explicit whitelist projection. */
export function buildRecInput(data: PropertyData, a: Analysis): RecInput {
  const p = data.property;
  return {
    propertyId: p.id, asOf: a.asOf, unitCount: data.snapshot.units.length,
    policy: {
      maxIncreasePct: p.maxIncreasePct, rentControl: p.rentControl, rentControlCapPct: p.rentControlCapPct,
      pricingSuggestions: p.pricingSuggestions, lateFeeGraceDay: p.lateFeeGraceDay, lateFeeAmount: p.lateFeeAmount,
      vacancyAlertDays: data.settings.vacancyAlertDays, expirationFlagShare: data.settings.expirationFlagShare,
    },
    units: data.snapshot.units.map((u) => ({ id: u.id, number: u.number, unitType: u.unitType, status: u.status, marketRent: u.marketRent, vacantSince: u.vacantSince })),
    leases: data.snapshot.leases.map((l) => ({
      id: l.id, unitId: l.unitId, start: l.start, end: l.end, mtm: l.mtm, contractRent: l.contractRent,
      recurring: l.recurring.map((r) => ({ type: r.type, amount: r.amount, billed: r.billed })),
      concessions: l.concessions.map((c) => ({ label: c.label, monthlyAmount: c.monthlyAmount, endsOn: c.endsOn })),
      depositHeld: l.depositHeld, depositRequired: l.depositRequired,
      subsidy: l.subsidy ? { ...l.subsidy } : null, lateFeeAuthorized: l.lateFeeAuthorized, mtmPremium: l.mtmPremium,
    })),
    lateMonths: a.late.map((m) => ({ leaseId: m.leaseId, period: m.period, feeCharged: m.feeCharged })),
  };
}

export type RecRule =
  | "renewals_below_market" | "unbilled_charges" | "concession_burnoff" | "month_to_month" | "long_vacancy"
  | "expiration_clustering" | "late_fees_uniform" | "deposit_shortfall" | "subsidy_mismatch";

export interface Recommendation {
  id: RecRule;
  /** gain = new revenue · protect = revenue already scheduled that needs a check · review = no dollar figure */
  kind: "gain" | "protect" | "review";
  title: string;
  /** what to do, in one sentence */
  action: string;
  units: string[];
  monthly: Cents;
  yearly: Cents;
  oneTime: Cents;
  /** the arithmetic, line by line */
  math: string[];
  evidence: { label: string; href: string };
  nextStep: { label: string; href: string };
  /** plain-English explanation; the AI may reword this, never the numbers */
  explanation: string;
}

/** Highest rent allowed at renewal: capped by the owner's max increase and any rent-control cap, never above market. */
export function suggestedRenewalRent(
  contract: Cents, market: Cents, policy: Pick<RecInput["policy"], "maxIncreasePct" | "rentControl" | "rentControlCapPct">,
): { rent: Cents; capPct: number; cappedBy: "market" | "max increase" | "rent control" } {
  const rc = policy.rentControl && policy.rentControlCapPct != null ? policy.rentControlCapPct : Infinity;
  const capPct = Math.min(policy.maxIncreasePct, rc);
  // round down to a whole $5 so the cap is never exceeded
  const capped = Math.floor((contract * (1 + capPct / 100)) / 500) * 500;
  if (market <= capped) return { rent: Math.max(market, contract), capPct, cappedBy: "market" };
  return { rent: Math.max(capped, contract), capPct, cappedBy: rc < policy.maxIncreasePct ? "rent control" : "max increase" };
}

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

export function runRecommendations(raw: RecInput): Recommendation[] {
  const input = RecInputSchema.parse(raw); // throws on any attribute outside the whitelist
  const { asOf, policy } = input;
  const unitById = new Map(input.units.map((u) => [u.id, u]));
  const num = (leaseId: string) => unitById.get(input.leases.find((l) => l.id === leaseId)!.unitId)!.number;
  const base = `/property/${input.propertyId}`;
  const rows = (units: string[]) => `${base}?tab=rent-roll&units=${units.join(",")}`;
  const out: Recommendation[] = [];
  const add = (r: Omit<Recommendation, "yearly"> & { yearly?: Cents }) => out.push({ ...r, yearly: r.yearly ?? r.monthly * 12 });

  // 1 — Renewals coming due below market
  if (policy.pricingSuggestions) {
    const until = addDays(asOf, 90);
    const due = input.leases.filter((l) => {
      const u = unitById.get(l.unitId)!;
      return !l.mtm && l.end && l.end >= asOf && l.end <= until && u.status !== "notice" && l.contractRent < u.marketRent;
    });
    if (due.length) {
      const lines = due.map((l) => {
        const u = unitById.get(l.unitId)!;
        const s = suggestedRenewalRent(l.contractRent, u.marketRent, policy);
        return { unit: u.number, gain: s.rent - l.contractRent, line: `Unit ${u.number}: ${money(l.contractRent)} → ${money(s.rent)} (market ${money(u.marketRent)}, limited by ${s.cappedBy}${s.cappedBy === "market" ? "" : ` of ${s.capPct}%`}) = +${money(s.rent - l.contractRent)}/mo; lease ends ${formatDate(l.end)}` };
      }).filter((x) => x.gain > 0);
      const monthly = lines.reduce((t, x) => t + x.gain, 0);
      if (monthly > 0) add({
        id: "renewals_below_market", kind: "gain", title: "Renew below-market leases closer to market",
        action: `Offer renewals at the suggested rents to ${plural(lines.length, "lease")} ending in the next 90 days.`,
        units: lines.map((x) => x.unit), monthly, oneTime: 0, math: lines.map((x) => x.line),
        evidence: { label: "See these leases", href: rows(lines.map((x) => x.unit)) },
        nextStep: { label: "Review expirations", href: `${base}?tab=expirations` },
        explanation: `${plural(lines.length, "lease")} ending within 90 days ${lines.length === 1 ? "is" : "are"} below your own market rent. Suggested rents never exceed market, your ${policy.maxIncreasePct}% maximum increase${policy.rentControl && policy.rentControlCapPct != null ? `, or the ${policy.rentControlCapPct}% rent-control cap` : ""}.`,
      });
    }
  }

  // 2 — Charges in the lease but not billed
  {
    const hits = input.leases.flatMap((l) => l.recurring.filter((r) => !r.billed).map((r) => ({ unit: num(l.id), r })));
    if (hits.length) {
      const monthly = hits.reduce((t, h) => t + h.r.amount, 0);
      add({
        id: "unbilled_charges", kind: "gain", title: "Bill charges that are in the lease",
        action: `Start billing ${plural(hits.length, "charge")} the lease provides for.`,
        units: hits.map((h) => h.unit), monthly, oneTime: 0,
        math: hits.map((h) => `Unit ${h.unit}: lease has a ${money(h.r.amount)}/mo ${h.r.type} fee; rent roll bills $0`),
        evidence: { label: "See these units", href: rows(hits.map((h) => h.unit)) },
        nextStep: { label: "Open the rent roll", href: rows(hits.map((h) => h.unit)) },
        explanation: "The signed lease includes a monthly charge that isn't on your billing rent roll, so it isn't being collected.",
      });
    }
  }

  // 3 — Concessions burning off soon
  {
    const until = addDays(asOf, 90);
    const hits = input.leases.flatMap((l) => l.concessions.filter((c) => c.endsOn >= asOf && c.endsOn <= until).map((c) => ({ unit: num(l.id), c })));
    if (hits.length) {
      add({
        id: "concession_burnoff", kind: "protect", title: "Make sure discounts end on schedule",
        action: `Confirm rent steps up when ${plural(hits.length, "discount")} end${hits.length === 1 ? "s" : ""}.`,
        units: hits.map((h) => h.unit), monthly: hits.reduce((t, h) => t + h.c.monthlyAmount, 0), oneTime: 0,
        math: hits.map((h) => `Unit ${h.unit}: ${money(h.c.monthlyAmount)}/mo discount ends ${formatDate(h.c.endsOn)} (${daysBetween(asOf, h.c.endsOn)} days)`),
        evidence: { label: "See these units", href: rows(hits.map((h) => h.unit)) },
        nextStep: { label: "Open the rent roll", href: rows(hits.map((h) => h.unit)) },
        explanation: "These move-in or renewal discounts end soon. The rent is already owed under the lease — this is a reminder to update billing so the step-up isn't missed.",
      });
    }
  }

  // 4 — Month-to-month residents
  {
    const lines = input.leases.filter((l) => l.mtm).map((l) => {
      const u = unitById.get(l.unitId)!;
      if (l.mtmPremium) return { unit: u.number, gain: l.mtmPremium, line: `Unit ${u.number}: lease allows a ${money(l.mtmPremium)}/mo month-to-month premium that isn't being charged` };
      if (!policy.pricingSuggestions) return { unit: u.number, gain: 0, line: `Unit ${u.number}: offer a new lease (pricing suggestions are off for this property)` };
      const s = suggestedRenewalRent(l.contractRent, u.marketRent, policy);
      return { unit: u.number, gain: s.rent - l.contractRent, line: `Unit ${u.number}: offer a new lease at ${money(s.rent)} (now ${money(l.contractRent)}, market ${money(u.marketRent)}) = +${money(s.rent - l.contractRent)}/mo` };
    });
    if (lines.length) add({
      id: "month_to_month", kind: "gain", title: "Move month-to-month residents onto a lease",
      action: `Offer a lease to ${plural(lines.length, "month-to-month resident")}, or apply the premium the lease allows.`,
      units: lines.map((x) => x.unit), monthly: lines.reduce((t, x) => t + x.gain, 0), oneTime: 0, math: lines.map((x) => x.line),
      evidence: { label: "See these units", href: rows(lines.map((x) => x.unit)) },
      nextStep: { label: "Review expirations", href: `${base}?tab=expirations` },
      explanation: "Month-to-month residents can leave with short notice and often sit below market. A new lease locks in the term; where the old lease allows a month-to-month premium, you can charge it instead.",
    });
  }

  // 5 — Vacant units sitting too long
  {
    const hits = input.units.filter((u) => u.status === "vacant" && u.vacantSince && daysBetween(u.vacantSince, asOf) > policy.vacancyAlertDays);
    if (hits.length) add({
      id: "long_vacancy", kind: "gain", title: "Fill units that have sat empty",
      action: `Prioritize leasing ${plural(hits.length, "unit")} vacant more than ${policy.vacancyAlertDays} days.`,
      units: hits.map((u) => u.number), monthly: hits.reduce((t, u) => t + u.marketRent, 0), oneTime: 0,
      math: hits.map((u) => {
        const days = daysBetween(u.vacantSince!, asOf);
        const perDay = Math.round(u.marketRent / 30);
        return `Unit ${u.number}: vacant ${days} days × ${money(perDay)}/day (${money(u.marketRent)} ÷ 30) = ${money(days * perDay)} lost so far`;
      }),
      evidence: { label: "See vacant units", href: rows(hits.map((u) => u.number)) },
      nextStep: { label: "Open the rent roll", href: `${base}?tab=rent-roll&status=vacant` },
      explanation: "Each empty day costs one-thirtieth of market rent. The monthly figure is what these units would bring in if leased at your market rent.",
    });
  }

  // 6 — Expiration clustering
  {
    const allowed = Math.floor(policy.expirationFlagShare * input.unitCount);
    const byMonth = new Map<string, string[]>();
    for (const l of input.leases) {
      if (l.mtm || !l.end || l.end < asOf || periodOf(l.end) > addMonths(periodOf(asOf), 11)) continue;
      const p = periodOf(l.end);
      byMonth.set(p, [...(byMonth.get(p) ?? []), num(l.id)]);
    }
    const flagged = [...byMonth.entries()].filter(([, us]) => us.length / input.unitCount > policy.expirationFlagShare).sort();
    if (flagged.length) add({
      id: "expiration_clustering", kind: "review", title: "Spread out lease expirations",
      action: `At renewal, offer terms a few months shorter or longer so fewer leases end in ${flagged.map(([p]) => formatDate(p, "month")).join(", ")}.`,
      units: flagged.flatMap(([, us]) => us), monthly: 0, oneTime: 0,
      math: flagged.map(([p, us]) => `${formatDate(p, "month")}: ${us.length} of ${input.unitCount} units expire (${Math.round((us.length / input.unitCount) * 100)}%); moving ${us.length - allowed} to other months brings it to ${Math.round(policy.expirationFlagShare * 100)}% or less`),
      evidence: { label: "See the schedule", href: `${base}?tab=expirations` },
      nextStep: { label: "Review expirations", href: `${base}?tab=expirations` },
      explanation: "When many leases end in the same month, a few move-outs can empty several units at once. Offering 9-, 10-, 13- or 14-month terms at renewal moves expirations into quieter months.",
    });
  }

  // 7 — Late fees applied inconsistently
  {
    const periods = [0, 1, 2].map((i) => addMonths(periodOf(asOf), -i));
    const excluded = new Set(input.leases.filter((l) => l.lateFeeAuthorized === false).map((l) => l.id));
    const recent = input.lateMonths.filter((m) => periods.includes(m.period) && !excluded.has(m.leaseId));
    const missed = recent.filter((m) => !m.feeCharged);
    const charged = recent.length - missed.length;
    if (missed.length) {
      const monthly = Math.round((missed.length * policy.lateFeeAmount) / periods.length);
      const units = [...new Set(missed.map((m) => num(m.leaseId)))].sort();
      add({
        id: "late_fees_uniform", kind: "gain", title: "Apply your late-fee policy the same way every time",
        action: "Charge the late fee to every resident who pays after the grace day — or to none. Never selectively.",
        units, monthly, oneTime: 0,
        math: [
          `Last 3 months: rent arrived after day ${policy.lateFeeGraceDay} ${plural(recent.length, "time")}; a fee was charged ${plural(charged, "time")} and not charged ${plural(missed.length, "time")}`,
          `${missed.length} missed × ${money(policy.lateFeeAmount)} ÷ 3 months = ${money(monthly)}/mo`,
          ...(excluded.size ? [`${plural(excluded.size, "lease")} left out because the lease on file has no late-fee clause`] : []),
        ],
        evidence: { label: "See these units", href: rows(units) },
        nextStep: { label: "Check late-fee policy", href: "/settings#late-fee" },
        explanation: "Your late fee was charged to some late payers and not others. Applying one rule to everyone is fairer, easier to defend, and collects what the lease provides. Only charge fees your leases authorize.",
      });
    }
  }

  // 8 — Deposits below the lease amount
  {
    const hits = input.leases.filter((l) => l.depositRequired != null && l.depositHeld < l.depositRequired);
    if (hits.length) add({
      id: "deposit_shortfall", kind: "gain", title: "Collect missing security deposit",
      action: `Collect the difference at renewal for ${plural(hits.length, "lease")}.`,
      units: hits.map((l) => num(l.id)), monthly: 0, yearly: 0,
      oneTime: hits.reduce((t, l) => t + (l.depositRequired! - l.depositHeld), 0),
      math: hits.map((l) => `Unit ${num(l.id)}: lease requires ${money(l.depositRequired)}; holding ${money(l.depositHeld)} = ${money(l.depositRequired! - l.depositHeld)} short`),
      evidence: { label: "See these units", href: rows(hits.map((l) => num(l.id))) },
      nextStep: { label: "Open the rent roll", href: rows(hits.map((l) => num(l.id))) },
      explanation: "You're holding less deposit than the lease calls for. This is a one-time amount, not monthly revenue.",
    });
  }

  // 9 — Subsidy split mismatches
  {
    const hits = input.leases.filter((l) => l.subsidy && l.subsidy.leaseTenantPortion != null && l.subsidy.leaseHapPortion != null &&
      (l.subsidy.leaseTenantPortion !== l.subsidy.tenantPortion || l.subsidy.leaseHapPortion !== l.subsidy.hapPortion));
    if (hits.length) add({
      id: "subsidy_mismatch", kind: "review", title: "Check voucher splits against the lease",
      action: `Compare ${plural(hits.length, "voucher lease")} with the housing authority's latest notice.`,
      units: hits.map((l) => num(l.id)), monthly: 0, oneTime: 0,
      math: hits.map((l) => `Unit ${num(l.id)}: billing tenant ${money(l.subsidy!.tenantPortion)} + voucher ${money(l.subsidy!.hapPortion)}; lease says tenant ${money(l.subsidy!.leaseTenantPortion)} + voucher ${money(l.subsidy!.leaseHapPortion)}`),
      evidence: { label: "See these units", href: rows(hits.map((l) => num(l.id))) },
      nextStep: { label: "Open the rent roll", href: rows(hits.map((l) => num(l.id))) },
      explanation: "The tenant and voucher portions being billed don't match the lease. One of them is out of date — the resident may be over- or under-paying. Tally flags this for review and doesn't change anything.",
    });
  }

  const order = { gain: 0, protect: 1, review: 2 };
  return out.sort((a, b) => order[a.kind] - order[b.kind] || b.yearly - a.yearly || b.oneTime - a.oneTime);
}

/** Headline: new yearly revenue available (scheduled step-ups and one-time amounts are not counted). */
export function availableRevenue(recs: Recommendation[]): { yearly: Cents; monthly: Cents; oneTime: Cents } {
  const gains = recs.filter((r) => r.kind === "gain");
  return { yearly: gains.reduce((t, r) => t + r.yearly, 0), monthly: gains.reduce((t, r) => t + r.monthly, 0), oneTime: gains.reduce((t, r) => t + r.oneTime, 0) };
}
