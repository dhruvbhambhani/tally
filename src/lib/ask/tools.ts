/**
 * Ask Tally. A question is routed (by the AI provider) to ONE of these query
 * functions; the function answers from the same tested metrics the screens
 * use and cites the rows. If nothing fits, the answer is "I don't know".
 */
import { getProvider } from "../ai/provider";
import type { Analysis } from "../analysis";
import type { PropertyData } from "../data/load";
import { formatDate } from "../dates";
import { money, pct } from "../money";
import { availableRevenue, buildRecInput, runRecommendations } from "../recs/engine";

export interface Citation { label: string; href: string }
export interface Answer { text: string; citations: Citation[]; tool: string | null }

interface Ctx { data: PropertyData; a: Analysis; args: Record<string, string | number> }
interface Tool { name: string; description: string; params: string; run: (c: Ctx) => Answer | Omit<Answer, "tool"> }

const base = (c: Ctx) => `/property/${c.data.property.id}`;
const unitRows = (c: Ctx, units: string[], label?: string): Citation[] =>
  units.length ? [{ label: label ?? `Rent roll: ${units.length === 1 ? "unit " + units[0] : units.length + " units"}`, href: `${base(c)}?tab=rent-roll&units=${units.join(",")}` }] : [];
const who = (c: Ctx, leaseId: string) => `${c.data.leaseById.get(leaseId)!.residents.join(" & ")} (unit ${c.data.unitNumberOf(leaseId)})`;

export const TOOLS: Tool[] = [
  {
    name: "late_payers", description: "Residents who paid rent late a given number of times or more", params: "minTimes: number (default 3)",
    run: (c) => {
      const min = Number(c.args.minTimes) || 3;
      const counts = new Map<string, string[]>();
      for (const m of c.a.late) counts.set(m.leaseId, [...(counts.get(m.leaseId) ?? []), m.period]);
      const hits = [...counts.entries()].filter(([, p]) => p.length >= min).sort((x, y) => y[1].length - x[1].length);
      const first = c.a.trend[0]?.period;
      if (!hits.length) return { text: `No one has paid late ${min} or more times since ${formatDate(first, "month")}.`, citations: [] };
      return {
        text: `${hits.length} resident${hits.length === 1 ? " has" : "s have"} paid late ${min}+ times since ${formatDate(first, "month")} (late = after day ${c.data.policy.graceDay}, or still unpaid):\n` +
          hits.map(([id, p]) => `• ${who(c, id)} — ${p.length} times (${p.map((x) => formatDate(x, "month").split(" ")[0]).join(", ")})`).join("\n"),
        citations: unitRows(c, hits.map(([id]) => c.data.unitNumberOf(id))),
      };
    },
  },
  {
    name: "loss_to_lease", description: "Loss-to-lease: how far contract rents sit below market rent", params: "",
    run: (c) => {
      const below = c.a.rentRoll.filter((r) => r.contractRent != null && r.contractRent < r.marketRent).sort((x, y) => (y.marketRent - y.contractRent!) - (x.marketRent - x.contractRent!));
      return {
        text: `Loss-to-lease at ${c.data.property.name} is ${money(c.a.waterfall.lossToLease)} a month (${pct(c.a.waterfall.lossToLease / c.a.waterfall.gpr)} of possible rent). ${below.length} leases are below market; the biggest gaps are ${below.slice(0, 3).map((r) => `unit ${r.unit} (${money(r.marketRent - r.contractRent!)})`).join(", ")}.`,
        citations: unitRows(c, below.map((r) => r.unit), `Rent roll: ${below.length} below-market leases`),
      };
    },
  },
  {
    name: "delinquency", description: "Who owes money, how much, and how old the debt is", params: "",
    run: (c) => {
      const ag = c.a.aging;
      if (!ag.byLease.length) return { text: "Nobody owes you money right now.", citations: [] };
      return {
        text: `${ag.byLease.length} residents owe ${money(ag.total)} in total — ${money(ag.totals["1-30"])} is 1–30 days late, ${money(ag.totals["31-60"])} is 31–60, ${money(ag.totals["61-90"])} is 61–90 and ${money(ag.totals["90+"])} is over 90:\n` +
          ag.byLease.map((l) => `• ${who(c, l.leaseId)} — ${money(l.balance)}, ${l.daysLate} days late`).join("\n"),
        citations: [{ label: "Delinquency list", href: "/delinquency" }],
      };
    },
  },
  {
    name: "collections", description: "Rent collected this month, collection rate, economic occupancy", params: "",
    run: (c) => ({
      text: `For ${formatDate(c.a.period, "month")} you've collected ${money(c.a.waterfall.collected)} of ${money(c.a.waterfall.gpr)} possible rent (${pct(c.a.waterfall.economicOccupancy)} economic occupancy). Of everything you billed this month, ${pct(c.a.collection.rate)} has been paid (${money(c.a.collection.collected)} of ${money(c.a.collection.billed)}).`,
      citations: [{ label: "Property overview", href: base(c) }],
    }),
  },
  {
    name: "occupancy", description: "Occupancy, vacant units and how long they have been empty", params: "",
    run: (c) => {
      const vac = c.a.vacancy.units.map((v) => ({ ...v, unit: c.data.unitById.get(v.unitId)!.number }));
      return {
        text: `${c.a.occupancy.occupied} of ${c.a.occupancy.total} units are occupied (${pct(c.a.occupancy.rate)}).` +
          (vac.length ? ` Vacant: ${vac.map((v) => `unit ${v.unit} (${v.days} days, about ${money(v.costPerDay)} a day)`).join(", ")}.` : ""),
        citations: unitRows(c, vac.map((v) => v.unit), "Rent roll: vacant units"),
      };
    },
  },
  {
    name: "expirations", description: "Lease expirations and renewals coming due", params: "",
    run: (c) => {
      const d90 = c.a.renewals.d90;
      const flagged = c.a.expirations.filter((m) => m.flagged);
      return {
        text: `${d90.length} leases come up for renewal in the next 90 days (${c.a.renewals.d30.length} within 30, ${c.a.renewals.d60.length} within 60).` +
          (flagged.length ? ` Watch ${flagged.map((m) => `${formatDate(m.period, "month")} — ${m.count} leases (${pct(m.share, 0)} of units) end that month`).join("; ")}.` : ""),
        citations: [{ label: "Expiration schedule", href: `${base(c)}?tab=expirations` }, ...unitRows(c, d90.map((l) => c.data.unitNumberOf(l.id)))],
      };
    },
  },
  {
    name: "month_to_month", description: "Residents on month-to-month", params: "",
    run: (c) => ({
      text: c.a.mtm.length ? `${c.a.mtm.length} residents are month-to-month: ${c.a.mtm.map((l) => who(c, l.id)).join(", ")}.` : "Nobody is month-to-month.",
      citations: unitRows(c, c.a.mtm.map((l) => c.data.unitNumberOf(l.id))),
    }),
  },
  {
    name: "deposits", description: "Security deposits held and shortfalls", params: "",
    run: (c) => {
      const d = c.a.deposits;
      return {
        text: `You hold ${money(d.held)} in deposits.` + (d.shortfalls.length
          ? ` ${d.shortfalls.map((x) => `Unit ${c.data.unitNumberOf(x.leaseId)} is ${money(x.shortfall)} short of its lease amount`).join("; ")}.`
          : ` Where a lease is on file (${d.knownCount} leases), deposits match the lease.`),
        citations: unitRows(c, d.shortfalls.map((x) => c.data.unitNumberOf(x.leaseId))),
      };
    },
  },
  {
    name: "unmatched_deposits", description: "Bank deposits Tally could not match to a resident", params: "",
    run: (c) => ({
      text: c.data.unmatched.length
        ? `${c.data.unmatched.length} deposits aren't matched to anyone:\n` + c.data.unmatched.map((p) => `• ${formatDate(p.date)} — ${money(p.amount)} ${p.payer ? "from " + p.payer : "(no name)"}: ${p.matchReason}`).join("\n")
        : "Every deposit is matched to a resident.",
      citations: [{ label: "Review queue", href: "/import" }],
    }),
  },
  {
    name: "unit_mix", description: "Unit mix: counts and average market vs contract rent by unit type", params: "",
    run: (c) => ({
      text: c.a.unitMix.map((m) => `• ${m.unitType}: ${m.count} units, market ${money(m.avgMarketRent)}, average rent ${money(m.avgContractRent)}`).join("\n"),
      citations: [{ label: "Rent roll", href: `${base(c)}?tab=rent-roll` }],
    }),
  },
  {
    name: "recommendations", description: "Ways to increase revenue, with dollar impact", params: "",
    run: (c) => {
      const recs = runRecommendations(buildRecInput(c.data, c.a));
      const total = availableRevenue(recs);
      return {
        text: `There's up to ${money(total.yearly)} a year available. Top items:\n` + recs.filter((r) => r.kind === "gain").slice(0, 4).map((r) => `• ${r.title} — ${r.yearly ? money(r.yearly) + "/yr" : money(r.oneTime) + " one-time"}`).join("\n"),
        citations: [{ label: "Ways to earn more", href: "/earn-more" }],
      };
    },
  },
  {
    name: "unit_detail", description: "Details for one unit: resident, rent, lease dates, balance", params: "unit: string",
    run: (c) => {
      const r = c.a.rentRoll.find((x) => x.unit.toLowerCase() === String(c.args.unit ?? "").toLowerCase());
      if (!r) return { text: "I don't know — I couldn't find that unit on your rent roll.", citations: [] };
      return {
        text: r.leaseId
          ? `Unit ${r.unit} (${r.unitType}): ${r.resident}. Rent ${money(r.contractRent)} against a market rent of ${money(r.marketRent)}. Lease ${r.mtm ? "is month-to-month" : `ends ${formatDate(r.leaseEnd)}`}. Balance ${money(r.balance)}${r.lastPayment ? `; last paid ${money(r.lastPayment.amount)} on ${formatDate(r.lastPayment.date)}` : ""}.`
          : `Unit ${r.unit} (${r.unitType}) is ${r.status}. Market rent ${money(r.marketRent)}.`,
        citations: unitRows(c, [r.unit]),
      };
    },
  },
];

export const SUGGESTED_QUESTIONS = [
  "Who's paid late 3+ times this year?",
  "What's my loss-to-lease?",
  "Who owes me money?",
  "Which leases are coming up for renewal?",
];

const DONT_KNOW = "I don't know. I can only answer from your own rent roll, payments and leases — try asking about who owes you, late payers, occupancy, renewals, deposits or a specific unit.";

export async function ask(question: string, data: PropertyData, a: Analysis): Promise<Answer> {
  const q = question.trim();
  if (!q) return { text: DONT_KNOW, citations: [], tool: null };
  let routed: { tool: string | null; args: Record<string, string | number> };
  try {
    routed = await getProvider().extract({ task: "ask_intent", question: q, tools: TOOLS.map(({ name, description, params }) => ({ name, description, params })) });
  } catch {
    return { text: "I couldn't reach the AI provider to understand that question. Nothing was guessed.", citations: [], tool: null };
  }
  const tool = TOOLS.find((t) => t.name === routed.tool);
  if (!tool) return { text: DONT_KNOW, citations: [], tool: null };
  return { ...tool.run({ data, a, args: routed.args ?? {} }), tool: tool.name };
}
