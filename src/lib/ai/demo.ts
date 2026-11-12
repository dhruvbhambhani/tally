/**
 * Demo provider: runs with no API key and never calls a model.
 *  - ledger images → fixtures recorded for the bundled sample scans
 *  - lease text    → labeled-field pattern matching (works on plainly worded leases)
 *  - questions     → keyword routing to the query functions
 *  - writing       → the deterministic template passed in as `fallback`
 */
import { parseDate } from "../dates";
import { parseMoney } from "../money";
import fixtures from "./fixtures/ledgers.json";
import {
  LEASE_FIELDS, type AIProvider, type Cell, type ExtractRequest, type ExtractResult, type GenerateRequest,
  type LeaseAbstract, type LedgerRow,
} from "./provider";

const none = (): Cell => ({ value: null, confidence: 0 });
const found = (value: string | number | null, raw: string, confidence = 0.92): Cell => ({ value, raw, confidence });

export function abstractLeaseText(text: string): LeaseAbstract {
  const t = text.replace(/\s+/g, " ");
  const f = Object.fromEntries(LEASE_FIELDS.map((k) => [k, none()])) as LeaseAbstract;
  const moneyAfter = (re: RegExp): Cell => {
    const m = t.match(re);
    if (!m) return none();
    const v = parseMoney(m[1]);
    return v == null ? none() : found(v, m[0]);
  };
  let m = t.match(/\bUnit\s+#?([A-Za-z0-9-]+)/);
  if (m) f.unit = found(m[1].replace(/[.,]$/, ""), m[0]);
  m = t.match(/made between .+? \("Landlord"\) and (.+?) \("Resident"\)/i);
  if (m) f.residents = found(m[1].split(/\s+and\s+|,\s*/).map((s) => s.trim()).filter(Boolean).join("; "), m[0]);
  m = t.match(/Begins\s+([A-Za-z]+ \d{1,2}, \d{4})\s+and ends\s+([A-Za-z]+ \d{1,2}, \d{4})/i);
  if (m) {
    f.start = found(parseDate(m[1]), m[1]);
    f.end = found(parseDate(m[2]), m[2]);
  }
  f.rent = moneyAfter(/Monthly Rent:\s*\$([\d,]+(?:\.\d{2})?)/i);
  f.deposit = moneyAfter(/Security Deposit:\s*\$([\d,]+(?:\.\d{2})?)/i);
  f.petFee = moneyAfter(/Pet Fee:\s*\$([\d,]+(?:\.\d{2})?)/i);
  f.parkingFee = moneyAfter(/Parking(?: Fee)?:\s*\$([\d,]+(?:\.\d{2})?)/i);
  f.mtmPremium = moneyAfter(/Month-to-Month Premium:\s*\$([\d,]+(?:\.\d{2})?)/i);
  f.tenantPortion = moneyAfter(/Tenant Portion:\s*\$([\d,]+(?:\.\d{2})?)/i);
  f.hapPortion = moneyAfter(/\(HAP\):\s*\$([\d,]+(?:\.\d{2})?)/i);
  m = t.match(/not received by the (\d{1,2})(?:st|nd|rd|th) day[^$]{0,80}late fee of \$([\d,]+(?:\.\d{2})?)/i);
  if (m) {
    f.lateFeeAfterDay = found(Number(m[1]), m[0]);
    f.lateFeeAmount = found(parseMoney(m[2]), m[0]);
  }
  m = t.match(/Rent Concession:\s*\$([\d,]+(?:\.\d{2})?) per month[^.]*?through ([A-Za-z]+ \d{1,2}, \d{4})/i);
  if (m) {
    f.concessionAmount = found(parseMoney(m[1]), m[0]);
    f.concessionEnds = found(parseDate(m[2]), m[2]);
  }
  m = t.match(/(the tenancy continues month-to-month[^.]*\.)/i);
  if (m) f.renewalTerms = found(m[1], m[1], 0.85);
  return f;
}

const TOOL_RULES: [RegExp, string][] = [
  [/late.*(times|often|\d\+)|paid late|pays late|chronic/i, "late_payers"],
  [/loss.?to.?lease|below.?market/i, "loss_to_lease"],
  [/who owes|owe me|delinquen|behind|past due|balance/i, "delinquency"],
  [/economic occupancy|collected|collect(ion)? rate|how much.*(come|came) in/i, "collections"],
  [/occupan|vacan|empty/i, "occupancy"],
  [/expir|renew|lease.*(end|up)/i, "expirations"],
  [/month.?to.?month|mtm/i, "month_to_month"],
  [/deposit/i, "deposits"],
  [/unmatched|unknown deposit|mystery/i, "unmatched_deposits"],
  [/unit mix|by type|bedroom/i, "unit_mix"],
  [/earn more|recommend|increase revenue|make more|what should i do/i, "recommendations"],
  [/unit\s+#?\d+|apt\s+#?\d+|tell me about/i, "unit_detail"],
];

export class DemoProvider implements AIProvider {
  name = "demo";
  demo = true;

  async extract<R extends ExtractRequest>(req: R): Promise<Extract<ExtractResult, { task: R["task"] }>> {
    type Out = Extract<ExtractResult, { task: R["task"] }>;
    if (req.task === "ledger_image") {
      const hit = fixtures.images.find((i) => i.sha256 === req.sha256) ?? fixtures.images.find((i) => i.fileName === req.fileName);
      if (!hit) {
        return { task: "ledger_image", rows: [], note: "Demo mode can only read the bundled sample scans. Add an API key to read your own handwriting." } as unknown as Out;
      }
      // fixtures store dollars as written; the provider contract is integer cents
      const rows = (hit.rows as unknown as LedgerRow[]).map((r) => ({
        ...r,
        cells: { ...r.cells, amount: { ...r.cells.amount, value: r.cells.amount.value == null ? null : Math.round(r.cells.amount.value * 100) } },
      }));
      return { task: "ledger_image", rows } as Out;
    }
    if (req.task === "lease") {
      return { task: "lease", fields: abstractLeaseText(req.text), note: "Read with pattern matching (demo mode)." } as Out;
    }
    const rule = TOOL_RULES.find(([re]) => re.test(req.question));
    const args: Record<string, string | number> = {};
    const unit = req.question.match(/(?:unit|apt)\.?\s+#?(\w+)/i);
    if (unit) args.unit = unit[1];
    const times = req.question.match(/(\d+)\s*(?:\+|or more)?\s*times/i);
    if (times) args.minTimes = Number(times[1]);
    const tool = rule && req.tools.some((t) => t.name === rule[1]) ? rule[1] : null;
    return { task: "ask_intent", tool, args } as Out;
  }

  async generate(req: GenerateRequest): Promise<string> {
    return req.fallback;
  }
}
