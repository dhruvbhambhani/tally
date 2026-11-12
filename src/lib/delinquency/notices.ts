/**
 * Formal notices come ONLY from template files in /templates/notices/{STATE}/,
 * merged with ledger data. Notice periods live in /config/notice-periods.json —
 * not in code and not in any AI prompt. The AI never writes a formal notice.
 */
import fs from "node:fs";
import path from "node:path";
import { formatDate } from "../dates";
import type { Cents, ISODate } from "../domain/types";
import type { LeaseAging } from "../metrics/ledger";
import { money } from "../money";

export type FormalNoticeType = "pay_or_quit" | "notice_to_vacate";
export type CaresStatus = "yes" | "no" | "unknown";

interface NoticeConfig {
  caresMinimumDays: number;
  states: Record<string, Partial<Record<FormalNoticeType, { days: number; title: string }>>>;
}

const ROOT = process.cwd();

export function loadNoticeConfig(): NoticeConfig {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "config", "notice-periods.json"), "utf8")) as NoticeConfig;
}

export interface AvailableNotice {
  type: FormalNoticeType;
  title: string;
  days: number;
  /** which folder the template came from: the state's own, or DEFAULT */
  templateState: string;
}

/** Notices with BOTH a configured period and a template file for this state (falling back to DEFAULT). */
export function availableNotices(state: string, config = loadNoticeConfig()): AvailableNotice[] {
  const st = state.toUpperCase();
  const out: AvailableNotice[] = [];
  for (const scope of [st, "DEFAULT"]) {
    const cfg = config.states[scope];
    if (!cfg) continue;
    for (const type of Object.keys(cfg) as FormalNoticeType[]) {
      if (out.some((o) => o.type === type)) continue;
      const file = path.join(ROOT, "templates", "notices", scope, `${type}.txt`);
      if (fs.existsSync(file)) out.push({ type, title: cfg[type]!.title, days: cfg[type]!.days, templateState: scope });
    }
    if (scope === st && out.length) break; // a state's own notices take the place of the generic ones
  }
  return out;
}

export interface PeriodCheck {
  /** the period the notice will use */
  days: number;
  /** true when the configured (shorter) period was blocked */
  blocked: boolean;
  /** one sentence, shown to the owner */
  explanation: string | null;
  /** CARES status is unknown — ask the owner to confirm */
  needsConfirmation: boolean;
}

/**
 * CARES Act guard. When the property is covered — or might be — a notice to
 * vacate for nonpayment shorter than 30 days is blocked and 30 days is used.
 */
export function checkNoticePeriod(configuredDays: number, cares: CaresStatus, minimum = 30): PeriodCheck {
  if (cares === "no" || configuredDays >= minimum) {
    return { days: configuredDays, blocked: false, explanation: null, needsConfirmation: false };
  }
  if (cares === "yes") {
    return {
      days: minimum, blocked: true, needsConfirmation: false,
      explanation: `The ${configuredDays}-day notice is blocked because this property is marked as covered by the federal CARES Act, which requires at least ${minimum} days' notice to vacate for nonpayment.`,
    };
  }
  return {
    days: minimum, blocked: true, needsConfirmation: true,
    explanation: `The ${configuredDays}-day notice is blocked because Tally doesn't know if this property is covered by the federal CARES Act (a federally backed mortgage or a federal subsidy may make it covered), and covered properties must give at least ${minimum} days' notice.`,
  };
}

export interface FormalNoticeInput {
  state: string;
  type: FormalNoticeType;
  cares: CaresStatus;
  asOf: ISODate;
  property: { name: string; address: string; city: string; state: string };
  unitNumber: string;
  residents: string[];
  aging: LeaseAging;
  /** true only when a lease on file authorizes late fees */
  lateFeeAuthorized: boolean | null;
  ownerName: string;
  assistanceText: string;
}

export interface FormalNotice {
  type: FormalNoticeType;
  title: string;
  text: string;
  amount: Cents;
  days: number;
  check: PeriodCheck;
  /** late fees left out because no lease on file authorizes them */
  excludedLateFees: Cents;
  templateState: string;
}

const CHARGE_LABELS: Record<string, string> = {
  rent: "Rent", pet: "Pet fee", parking: "Parking", storage: "Storage", utilities: "Utilities", other: "Other charge", late_fee: "Late fee",
};

export function buildFormalNotice(input: FormalNoticeInput): FormalNotice {
  const config = loadNoticeConfig();
  const avail = availableNotices(input.state, config).find((n) => n.type === input.type);
  if (!avail) throw new Error(`No ${input.type} template for ${input.state}`);
  const check = checkNoticePeriod(avail.days, input.cares, config.caresMinimumDays);

  // A formal notice can't include late fees the lease doesn't authorize.
  const includeLateFees = input.lateFeeAuthorized === true;
  const lines = input.aging.openCharges.filter((s) => includeLateFees || s.charge.type !== "late_fee");
  const excludedLateFees = includeLateFees ? 0 : input.aging.lateFeesOpen;
  const amount = lines.reduce((t, s) => t + s.open, 0);
  const itemized = lines
    .map((s) => `  ${formatDate(s.charge.period, "month").padEnd(10)} ${(CHARGE_LABELS[s.charge.type] ?? s.charge.type).padEnd(12)} ${money(s.open, { cents: true }).padStart(11)}`)
    .join("\n") + `\n  ${"".padEnd(10)} ${"Total".padEnd(12)} ${money(amount, { cents: true }).padStart(11)}`;

  const template = fs.readFileSync(path.join(ROOT, "templates", "notices", avail.templateState, `${input.type}.txt`), "utf8");
  const fields: Record<string, string> = {
    title: avail.title.toUpperCase(),
    date: formatDate(input.asOf, "long"),
    residents: input.residents.join(" and "),
    unit: input.unitNumber,
    property_name: input.property.name,
    property_address: [input.property.address, input.property.city, input.property.state].filter(Boolean).join(", "),
    amount: money(amount, { cents: true }),
    itemized,
    excluded_note: "", // excluded fees are explained to the owner in the app, never printed on the notice
    days: String(check.days),
    owner_name: input.ownerName,
    assistance_note: input.assistanceText,
  };
  const text = template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => fields[k] ?? `{{${k}}}`).replace(/\n{3,}/g, "\n\n");
  return { type: input.type, title: avail.title, text, amount, days: check.days, check, excludedLateFees, templateState: avail.templateState };
}
