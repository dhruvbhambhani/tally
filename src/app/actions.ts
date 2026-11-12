"use server";

import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ask as askTally, type Answer } from "@/lib/ask/tools";
import { getContext } from "@/lib/context";
import { listProperties } from "@/lib/data/load";
import { ensureProperty, importSampleData } from "@/lib/data/sample";
import { parseDate } from "@/lib/dates";
import { getDb } from "@/lib/db/client";
import { conflicts, notices, promises, properties, resolutions, stagedRows, units } from "@/lib/db/schema";
import { writeLetter, type Channel, type FriendlyType, type Language } from "@/lib/delinquency/letters";
import { buildFormalNotice, type FormalNoticeType } from "@/lib/delinquency/notices";
import { ingestFile, remapTable, type IngestResult } from "@/lib/ingest/stage";
import { parseMoney } from "@/lib/money";
import { buildRentRoll } from "@/lib/reconcile/build";
import { resolveSettings, type LadderStep } from "@/lib/settings";

function targetPropertyId(): string {
  const db = getDb();
  const existing = listProperties(db);
  if (existing.length) return (existing.find((p) => p.unitCount > 0) ?? existing[0]).id;
  ensureProperty(db, "my-property", "My property");
  return "my-property";
}

/** Rebuild quietly when a rent roll already exists, so review decisions show up everywhere. */
function rebuildIfBuilt(propertyId: string) {
  const db = getDb();
  if (db.select().from(units).where(eq(units.propertyId, propertyId)).all().length) buildRentRoll(db, propertyId);
  revalidatePath("/", "layout");
}

export async function uploadFiles(formData: FormData): Promise<IngestResult[]> {
  const db = getDb();
  const propertyId = targetPropertyId();
  const out: IngestResult[] = [];
  for (const file of formData.getAll("files")) {
    if (!(file instanceof File) || !file.size) continue;
    out.push(await ingestFile(db, propertyId, file.name, Buffer.from(await file.arrayBuffer())));
  }
  revalidatePath("/", "layout");
  return out;
}

export async function loadSample(): Promise<void> {
  await importSampleData(getDb());
  revalidatePath("/", "layout");
}

export async function saveMapping(fileId: string, sheet: string, mapping: Record<string, string>): Promise<void> {
  const db = getDb();
  remapTable(db, fileId, sheet, mapping);
  rebuildIfBuilt(targetPropertyId());
}

export async function reviewRow(rowId: string, decision: "accept" | "reject" | "fix", fixes: Record<string, string> = {}): Promise<{ error?: string }> {
  const db = getDb();
  const row = db.select().from(stagedRows).where(eq(stagedRows.id, rowId)).get();
  if (!row) return { error: "That item no longer exists." };
  if (decision === "fix") {
    const data = { ...row.data };
    for (const [field, raw] of Object.entries(fixes)) {
      if (raw.trim() === "") continue;
      let value: string | number | null = raw.trim();
      if (/amount|rent|deposit|fee|portion|premium/i.test(field)) {
        value = parseMoney(raw);
        if (value == null) return { error: `"${raw}" isn't an amount.` };
      } else if (/date|start|end|since|moveIn/i.test(field)) {
        value = parseDate(raw);
        if (value == null) return { error: `"${raw}" isn't a real date.` };
      }
      data[field] = { value, raw: data[field]?.raw ?? raw, confidence: 1 }; // the owner said so
    }
    db.update(stagedRows).set({ data, status: "fixed", reviewReason: null }).where(eq(stagedRows.id, rowId)).run();
  } else {
    db.update(stagedRows).set({ status: decision === "accept" ? "accepted" : "rejected" }).where(eq(stagedRows.id, rowId)).run();
  }
  rebuildIfBuilt(row.propertyId);
  return {};
}

export async function resolveConflict(conflictId: string, value: string): Promise<void> {
  const db = getDb();
  const c = db.select().from(conflicts).where(eq(conflicts.id, conflictId)).get();
  if (!c) return;
  db.insert(resolutions).values({ key: conflictId, value }).onConflictDoUpdate({ target: resolutions.key, set: { value, decidedAt: new Date().toISOString() } }).run();
  rebuildIfBuilt(c.propertyId);
}

/** The owner tells Tally which unit an unmatched deposit belongs to. */
export async function assignDeposit(stagedRowId: string, unit: string): Promise<{ error?: string }> {
  const db = getDb();
  const row = db.select().from(stagedRows).where(eq(stagedRows.id, stagedRowId)).get();
  if (!row) return { error: "That deposit no longer exists." };
  const u = unit.trim().toUpperCase();
  const known = db.select().from(units).where(and(eq(units.propertyId, row.propertyId), eq(units.number, u))).get();
  if (!known) return { error: `There's no unit ${unit} on the rent roll.` };
  const data = { ...row.data, memo: { value: `UNIT ${u} (assigned by owner)`, confidence: 1 } };
  db.update(stagedRows).set({ data, status: "fixed" }).where(eq(stagedRows.id, stagedRowId)).run();
  rebuildIfBuilt(row.propertyId);
  return {};
}

export async function buildNow(): Promise<void> {
  const db = getDb();
  const propertyId = targetPropertyId();
  buildRentRoll(db, propertyId);
  revalidatePath("/", "layout");
  redirect(`/property/${propertyId}`);
}

export async function updateSettings(formData: FormData): Promise<void> {
  const ctx = await getContext();
  if (!ctx) return;
  const db = getDb();
  const p = ctx.data.property;
  const s = resolveSettings(p.settings);
  const str = (k: string) => String(formData.get(k) ?? "").trim();
  const num = (k: string, fallback: number) => {
    const v = Number(str(k));
    return str(k) !== "" && isFinite(v) ? v : fallback;
  };
  const ladder: LadderStep[] = s.ladder.map((step) => ({ ...step, afterDays: Math.max(0, Math.round(num(`ladder_${step.key}`, step.afterDays))) }));
  const cares = str("caresCovered");
  db.update(properties).set({
    name: str("name") || p.name, address: str("address"), city: str("city"), state: str("state").toUpperCase().slice(0, 2),
    caresCovered: cares === "yes" || cares === "no" ? cares : "unknown",
    rentControl: formData.get("rentControl") === "on",
    rentControlCapPct: str("rentControlCapPct") === "" ? null : num("rentControlCapPct", 0),
    maxIncreasePct: num("maxIncreasePct", p.maxIncreasePct),
    pricingSuggestions: formData.get("pricingSuggestions") === "on",
    lateFeeGraceDay: Math.min(28, Math.max(1, Math.round(num("lateFeeGraceDay", p.lateFeeGraceDay)))),
    lateFeeAmount: parseMoney(str("lateFeeAmount")) ?? p.lateFeeAmount,
    settings: {
      ...s, ladder,
      ownerName: str("ownerName") || s.ownerName,
      rentalAssistanceText: str("rentalAssistanceText") || s.rentalAssistanceText,
      rentalAssistanceTextEs: str("rentalAssistanceTextEs") || s.rentalAssistanceTextEs,
      vacancyAlertDays: Math.round(num("vacancyAlertDays", s.vacancyAlertDays)),
      expirationFlagShare: num("expirationFlagPct", s.expirationFlagShare * 100) / 100,
      paymentPlanMonths: Math.max(1, Math.round(num("paymentPlanMonths", s.paymentPlanMonths))),
      benchmarks: {
        lossToLeasePct: { min: num("ltlMin", s.benchmarks.lossToLeasePct.min), max: num("ltlMax", s.benchmarks.lossToLeasePct.max), source: str("ltlSource") || s.benchmarks.lossToLeasePct.source },
        occupancyGapPts: { min: num("gapMin", s.benchmarks.occupancyGapPts.min), max: num("gapMax", s.benchmarks.occupancyGapPts.max), source: str("gapSource") || s.benchmarks.occupancyGapPts.source },
      },
    },
  }).where(eq(properties.id, p.id)).run();
  revalidatePath("/", "layout");
  redirect("/settings?saved=1");
}

// ---------- letters ----------
export interface DraftRequest { leaseId: string; type: FriendlyType | FormalNoticeType; channel: Channel; language: Language }
export interface Draft {
  kind: "friendly" | "formal";
  title: string;
  subject: string;
  body: string;
  amount: number | null;
  /** shown to the owner above the preview (CARES block, excluded late fees, sample warning) */
  alerts: { tone: "info" | "block"; text: string }[];
}

export async function draftLetter(req: DraftRequest): Promise<Draft | { error: string }> {
  const ctx = await getContext();
  if (!ctx) return { error: "No rent roll yet." };
  const { data, a } = ctx;
  const lease = data.leaseById.get(req.leaseId);
  if (!lease) return { error: "Resident not found." };
  const unitNumber = data.unitNumberOf(lease.id);
  const aging = a.agingByLease.get(lease.id) ?? null;
  const row = a.rentRoll.find((r) => r.leaseId === lease.id);
  const s = data.settings;

  if (req.type === "pay_or_quit" || req.type === "notice_to_vacate") {
    if (!aging) return { error: "This resident has no balance, so a notice can't be prepared." };
    try {
      const n = buildFormalNotice({
        state: data.property.state, type: req.type, cares: data.property.caresCovered, asOf: a.asOf, property: data.property,
        unitNumber, residents: lease.residents, aging, lateFeeAuthorized: lease.lateFeeAuthorized, ownerName: s.ownerName,
        assistanceText: s.rentalAssistanceText,
      });
      const alerts: Draft["alerts"] = [{ tone: "info", text: "Sample template — have your attorney review before use. Formal notices are never written by AI." }];
      if (n.check.explanation) alerts.push({ tone: "block", text: n.check.explanation + (n.check.needsConfirmation ? " Confirm the property's status in Settings." : "") + ` This notice uses ${n.days} days.` });
      if (n.excludedLateFees > 0) alerts.push({ tone: "info", text: `A late fee of $${(n.excludedLateFees / 100).toFixed(2)} was left out because there is no lease on file that authorizes it.` });
      return { kind: "formal", title: n.title, subject: n.title, body: n.text, amount: n.amount, alerts };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }
  const letter = await writeLetter({
    type: req.type, channel: req.channel, language: req.language, asOf: a.asOf, propertyName: data.property.name, ownerName: s.ownerName,
    unitNumber, residents: lease.residents, aging, lastPayment: row?.lastPayment ?? null, planMonths: s.paymentPlanMonths,
    assistanceText: req.language === "es" ? s.rentalAssistanceTextEs : s.rentalAssistanceText,
  });
  return { kind: "friendly", title: letter.subject || "Text message", subject: letter.subject, body: letter.body, amount: letter.amount, alerts: [] };
}

/** Approve a letter. Tally never sends anything: this records the owner's approval, and later how it was delivered. */
export async function approveLetter(input: { leaseId: string; type: string; language: string; body: string; amount: number | null }): Promise<{ id: string } | { error: string }> {
  const ctx = await getContext();
  if (!ctx) return { error: "No rent roll yet." };
  const lease = ctx.data.leaseById.get(input.leaseId);
  if (!lease) return { error: "Resident not found." };
  const id = crypto.randomUUID();
  getDb().insert(notices).values({
    id, propertyId: ctx.data.property.id, unitNumber: ctx.data.unitNumberOf(lease.id), resident: lease.residents.join(" & "), type: input.type,
    language: input.language, body: input.body, amount: input.amount, status: "approved", approvedBy: ctx.data.settings.ownerName,
    approvedAt: new Date().toISOString(), sourceId: null, confidence: 1,
  }).run();
  revalidatePath("/delinquency");
  return { id };
}

export async function markSent(noticeId: string, method: string): Promise<void> {
  getDb().update(notices).set({ status: "sent", method, sentAt: new Date().toISOString() }).where(eq(notices.id, noticeId)).run();
  revalidatePath("/delinquency");
}

export async function addPromise(unitNumber: string, amountRaw: string, dateRaw: string, note: string): Promise<{ error?: string }> {
  const ctx = await getContext();
  if (!ctx) return { error: "No rent roll yet." };
  const amount = parseMoney(amountRaw);
  const date = parseDate(dateRaw);
  if (amount == null || amount <= 0) return { error: "Enter the amount promised." };
  if (!date) return { error: "Enter the date promised." };
  getDb().insert(promises).values({ id: crypto.randomUUID(), propertyId: ctx.data.property.id, unitNumber, amount, promisedFor: date, note }).run();
  revalidatePath("/delinquency");
  return {};
}

export async function askQuestion(question: string): Promise<Answer> {
  const ctx = await getContext();
  if (!ctx) return { text: "I don't know — there's no rent roll yet. Add your data first.", citations: [], tool: null };
  return askTally(question, ctx.data, ctx.a);
}
