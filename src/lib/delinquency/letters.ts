/**
 * Friendly letters. The wording may be polished by the AI provider, but every
 * figure (balance, itemization, plan schedule) is computed here and passed in
 * as facts; text whose dollar amounts don't match the facts is discarded.
 */
import { getProvider } from "../ai/provider";
import { addMonths, formatDate, periodOf } from "../dates";
import type { Cents, ISODate } from "../domain/types";
import type { LeaseAging } from "../metrics/ledger";
import { money } from "../money";
import type { LadderStep, LadderStepKey } from "../settings";

export type FriendlyType = "friendly_reminder" | "second_reminder" | "payment_plan" | "payment_receipt";
export type Channel = "letter" | "email" | "sms";
export type Language = "en" | "es";

export const FRIENDLY_LABELS: Record<FriendlyType, string> = {
  friendly_reminder: "Friendly reminder",
  second_reminder: "Second reminder",
  payment_plan: "Payment-plan offer",
  payment_receipt: "Payment receipt",
};

// ---------- ladder ----------
/** The furthest step whose day threshold has been reached. */
export function suggestedStep(daysLate: number, ladder: LadderStep[]): LadderStep | null {
  const reached = [...ladder].sort((a, b) => a.afterDays - b.afterDays).filter((s) => daysLate >= s.afterDays);
  return reached.length ? reached[reached.length - 1] : null;
}

export const STEP_TO_LETTER: Partial<Record<LadderStepKey, FriendlyType>> = {
  friendly_reminder: "friendly_reminder", second_reminder: "second_reminder", payment_plan: "payment_plan",
};

// ---------- payment plan ----------
export interface Installment { due: ISODate; amount: Cents }

/**
 * Split a balance into equal monthly installments due on the 15th, starting
 * with the next 15th. Any leftover cents go on the first installment so the
 * schedule always adds up to the balance exactly.
 */
export function paymentPlan(balance: Cents, months: number, asOf: ISODate): Installment[] {
  if (balance <= 0 || months < 1) return [];
  const each = Math.floor(balance / months);
  const extra = balance - each * months;
  const first = asOf.slice(8) <= "15" ? periodOf(asOf) : addMonths(periodOf(asOf), 1);
  return Array.from({ length: months }, (_, i) => ({ due: `${addMonths(first, i)}-15`, amount: each + (i === 0 ? extra : 0) }));
}

// ---------- letters ----------
export interface LetterInput {
  type: FriendlyType;
  channel: Channel;
  language: Language;
  asOf: ISODate;
  propertyName: string;
  ownerName: string;
  unitNumber: string;
  residents: string[];
  aging: LeaseAging | null;
  lastPayment: { date: ISODate; amount: Cents } | null;
  planMonths: number;
  assistanceText: string;
}

export interface Letter {
  subject: string;
  body: string;
  amount: Cents | null;
  plan: Installment[];
  facts: Record<string, string | number>;
}

const LABELS = {
  en: { rent: "rent", pet: "pet fee", parking: "parking", storage: "storage", utilities: "utilities", other: "other charge", late_fee: "late fee" },
  es: { rent: "renta", pet: "cargo por mascota", parking: "estacionamiento", storage: "bodega", utilities: "servicios", other: "otro cargo", late_fee: "cargo por pago tardío" },
} as const;

const dateIn = (d: ISODate, lang: Language, month = false) =>
  new Date(`${d.length === 7 ? d + "-01" : d}T00:00:00Z`).toLocaleDateString(lang === "es" ? "es-US" : "en-US",
    month ? { month: "long", year: "numeric", timeZone: "UTC" } : { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

function firstNames(residents: string[], lang: Language): string {
  const names = residents.map((r) => r.split(" ")[0]);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} ${lang === "es" ? "y" : "and"} ${names[names.length - 1]}` : names[0] ?? "";
}

/** Deterministic template text. Also the fallback whenever AI wording fails verification. */
export function templateLetter(i: LetterInput): Letter {
  const es = i.language === "es";
  const hi = firstNames(i.residents, i.language);
  const balance = i.aging?.balance ?? 0;
  const bal = money(balance, { cents: true });
  const items = (i.aging?.openCharges ?? [])
    .map((s) => `  • ${dateIn(s.charge.period, i.language, true)} ${LABELS[i.language][s.charge.type as keyof (typeof LABELS)["en"]] ?? s.charge.type}: ${money(s.open, { cents: true })}`)
    .join("\n");
  const plan = i.type === "payment_plan" ? paymentPlan(balance, i.planMonths, i.asOf) : [];
  const planLines = plan.map((p) => `  • ${dateIn(p.due, i.language)}: ${money(p.amount, { cents: true })}`).join("\n");
  const sign = es ? `Gracias,\n${i.ownerName}\n${i.propertyName}` : `Thank you,\n${i.ownerName}\n${i.propertyName}`;
  const facts: Record<string, string | number> = {
    resident: hi, unit: i.unitNumber, property: i.propertyName, balance: bal, itemized: items, date: formatDate(i.asOf, "long"),
    assistance: i.assistanceText, owner: i.ownerName,
  };
  if (plan.length) facts.plan = planLines;
  if (i.lastPayment) {
    facts.lastPaymentAmount = money(i.lastPayment.amount, { cents: true });
    facts.lastPaymentDate = dateIn(i.lastPayment.date, i.language);
  }

  let subject = "";
  let body = "";
  if (i.type === "payment_receipt") {
    const amt = i.lastPayment ? money(i.lastPayment.amount, { cents: true }) : money(0);
    const on = i.lastPayment ? dateIn(i.lastPayment.date, i.language) : "";
    subject = es ? `Recibo de pago — Unidad ${i.unitNumber}` : `Payment receipt — Unit ${i.unitNumber}`;
    body = es
      ? `Hola ${hi}:\n\nRecibimos su pago de ${amt} el ${on} para la Unidad ${i.unitNumber}. ${balance > 0 ? `Su saldo pendiente es ${bal}.` : "Su cuenta está al día."}\n\n${sign}`
      : `Hi ${hi},\n\nWe received your payment of ${amt} on ${on} for Unit ${i.unitNumber}. ${balance > 0 ? `Your remaining balance is ${bal}.` : "Your account is current."}\n\n${sign}`;
  } else if (i.channel === "sms") {
    subject = "";
    const core = {
      friendly_reminder: es ? `Hola ${hi}, un recordatorio amable de ${i.propertyName}: su cuenta de la Unidad ${i.unitNumber} muestra un saldo de ${bal}. Si ya pagó, gracias. ¿Preguntas? Responda a este mensaje.`
        : `Hi ${hi}, a friendly reminder from ${i.propertyName}: your account for Unit ${i.unitNumber} shows a balance of ${bal}. If you've already paid, thank you. Questions? Just reply.`,
      second_reminder: es ? `Hola ${hi}, de ${i.propertyName}: la Unidad ${i.unitNumber} todavía muestra un saldo de ${bal}. Por favor contáctenos esta semana para ponerse al día o acordar un plan.`
        : `Hi ${hi}, from ${i.propertyName}: Unit ${i.unitNumber} still shows a balance of ${bal}. Please get in touch this week so we can get it caught up or set up a plan.`,
      payment_plan: es ? `Hola ${hi}, de ${i.propertyName}: podemos ofrecerle un plan de ${plan.length} pagos para el saldo de ${bal} de la Unidad ${i.unitNumber}. Responda para recibir los detalles.`
        : `Hi ${hi}, from ${i.propertyName}: we can offer a ${plan.length}-payment plan for the ${bal} balance on Unit ${i.unitNumber}. Reply and we'll send the details.`,
    }[i.type];
    body = `${core} ${i.assistanceText}`;
  } else if (i.type === "friendly_reminder") {
    subject = es ? `Recordatorio amable — Unidad ${i.unitNumber}` : `Friendly reminder — Unit ${i.unitNumber}`;
    body = es
      ? `Hola ${hi}:\n\nEste es un recordatorio amable de que su cuenta de la Unidad ${i.unitNumber} muestra un saldo de ${bal} al ${dateIn(i.asOf, "es")}:\n\n${items}\n\nSi ya envió su pago, gracias; por favor ignore esta nota. Si algo no se ve correcto, avísenos y lo revisamos juntos.\n\n${i.assistanceText}\n\n${sign}`
      : `Hi ${hi},\n\nThis is a friendly reminder that your account for Unit ${i.unitNumber} shows a balance of ${bal} as of ${dateIn(i.asOf, "en")}:\n\n${items}\n\nIf you've already sent payment, thank you — please disregard this note. If something doesn't look right, let us know and we'll go over it together.\n\n${i.assistanceText}\n\n${sign}`;
  } else if (i.type === "second_reminder") {
    subject = es ? `Segundo recordatorio — Unidad ${i.unitNumber}` : `Second reminder — Unit ${i.unitNumber}`;
    body = es
      ? `Hola ${hi}:\n\nLe escribimos de nuevo porque su cuenta de la Unidad ${i.unitNumber} todavía muestra un saldo de ${bal}:\n\n${items}\n\nQueremos ayudarle a ponerse al día. Por favor comuníquese con nosotros esta semana para pagar el saldo o para hablar de un plan de pagos.\n\n${i.assistanceText}\n\n${sign}`
      : `Hi ${hi},\n\nWe're following up because your account for Unit ${i.unitNumber} still shows a balance of ${bal}:\n\n${items}\n\nWe'd like to help you get caught up. Please contact us this week to pay the balance or to talk about a payment plan.\n\n${i.assistanceText}\n\n${sign}`;
  } else {
    subject = es ? `Oferta de plan de pagos — Unidad ${i.unitNumber}` : `Payment-plan offer — Unit ${i.unitNumber}`;
    body = es
      ? `Hola ${hi}:\n\nSu cuenta de la Unidad ${i.unitNumber} muestra un saldo de ${bal}. Para ayudarle a ponerse al día, podemos ofrecerle este plan de pagos, además de su renta mensual regular:\n\n${planLines}\n\nSi este plan le funciona, responda a esta carta y le enviaremos un acuerdo para firmar. Si necesita otras fechas, hablemos.\n\n${i.assistanceText}\n\n${sign}`
      : `Hi ${hi},\n\nYour account for Unit ${i.unitNumber} shows a balance of ${bal}. To help you get caught up, we can offer this payment plan, in addition to your regular monthly rent:\n\n${planLines}\n\nIf this plan works for you, reply to this letter and we'll send an agreement to sign. If you need different dates, let's talk.\n\n${i.assistanceText}\n\n${sign}`;
  }
  return { subject, body, amount: i.type === "payment_receipt" ? (i.lastPayment?.amount ?? null) : balance, plan, facts };
}

/** Template first; the AI provider may reword it, but the figures must survive intact. */
export async function writeLetter(input: LetterInput): Promise<Letter> {
  const base = templateLetter(input);
  const body = await (await getProvider()).generate({
    task: `${input.type}_${input.channel}`, language: input.language, facts: base.facts, fallback: base.body,
    instructions: input.channel === "sms" ? "This is a text message: under 320 characters." : "Keep the itemized lines exactly as given.",
  });
  return { ...base, body };
}
