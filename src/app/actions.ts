"use server";

import crypto from "node:crypto";
import fs from "node:fs";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { BASE_URLS, DEFAULT_MODELS } from "@/lib/ai/provider";
import { ask as askTally, type Answer } from "@/lib/ask/tools";
import { getContext, getProperties, getReadyDb } from "@/lib/context";
import { ensureProperty, importSampleData, SAMPLE_PROPERTY_ID } from "@/lib/data/sample";
import { parseDate } from "@/lib/dates";
import { wipeDb, type DB } from "@/lib/db/client";
import {
  charges, comps, conflicts, fieldProvenance, leases, notices, payments, promises, properties, resolutions, sourceFiles, stagedRows, units,
} from "@/lib/db/schema";
import { writeLetter, type Channel, type FriendlyType, type Language } from "@/lib/delinquency/letters";
import { buildFormalNotice, type FormalNoticeType } from "@/lib/delinquency/notices";
import { fetchLinkedFile, MAX_IMPORT_BYTES, normalizeImportUrl } from "@/lib/ingest/link";
import { ingestFile, remapTable, type IngestResult } from "@/lib/ingest/stage";
import { parseMoney } from "@/lib/money";
import { buildRentRoll } from "@/lib/reconcile/build";
import { AI_COOKIE, cookieOptions, PROPERTY_COOKIE, type AIProviderName } from "@/lib/session";
import { resolveSettings, type LadderStep } from "@/lib/settings";

const ALLOWED = /\.(csv|tsv|txt|xlsx|xls|pdf|jpe?g|png|webp|tiff?)$/i;

/** The property new files go into: the selected one, or a first property created on the spot. */
async function targetProperty(): Promise<{ db: DB; propertyId: string }> {
  const { db, current } = await getProperties();
  if (current) return { db, propertyId: current.id };
  ensureProperty(db, "my-property", "My property");
  (await cookies()).set(PROPERTY_COOKIE, "my-property", cookieOptions);
  return { db, propertyId: "my-property" };
}

/** Rebuild quietly when a rent roll already exists, so review decisions show up everywhere. */
function rebuildIfBuilt(db: DB, propertyId: string) {
  if (db.select().from(units).where(eq(units.propertyId, propertyId)).all().length) buildRentRoll(db, propertyId);
  revalidatePath("/", "layout");
}

export async function uploadFiles(formData: FormData): Promise<IngestResult[]> {
  const { db, propertyId } = await targetProperty();
  const out: IngestResult[] = [];
  for (const file of formData.getAll("files")) {
    if (!(file instanceof File) || !file.size) continue;
    if (!ALLOWED.test(file.name)) {
      out.push({ fileId: "", name: file.name, kind: "unknown", rows: 0, needsReview: 0, note: "Tally reads CSV, Excel, PDF and image files." });
      continue;
    }
    if (file.size > MAX_IMPORT_BYTES) {
      out.push({ fileId: "", name: file.name, kind: "unknown", rows: 0, needsReview: 0, note: "That file is larger than 25 MB." });
      continue;
    }
    out.push(await ingestFile(db, propertyId, file.name, Buffer.from(await file.arrayBuffer())));
  }
  revalidatePath("/", "layout");
  return out;
}

/** Import a Google Sheet or a CSV/Excel link. The link is saved with the file so it can be refreshed later. */
export async function importFromLink(link: string): Promise<IngestResult | { error: string }> {
  try {
    const target = normalizeImportUrl(link);
    const buf = await fetchLinkedFile(target);
    const { db, propertyId } = await targetProperty();
    const res = await ingestFile(db, propertyId, target.fileName, buf, { link: link.trim() });
    rebuildIfBuilt(db, propertyId);
    return res;
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Re-download a linked file and re-read it. */
export async function refreshLink(fileId: string): Promise<{ error?: string }> {
  const db = await getReadyDb();
  const file = db.select().from(sourceFiles).where(eq(sourceFiles.id, fileId)).get();
  const link = file?.meta.link as string | undefined;
  if (!file || !link) return { error: "That file isn't connected to a link." };
  try {
    const target = normalizeImportUrl(link);
    await ingestFile(db, file.propertyId, file.name, await fetchLinkedFile(target), { link });
    rebuildIfBuilt(db, file.propertyId);
    return {};
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function removeFile(fileId: string): Promise<void> {
  const db = await getReadyDb();
  const file = db.select().from(sourceFiles).where(eq(sourceFiles.id, fileId)).get();
  if (!file) return;
  db.delete(stagedRows).where(eq(stagedRows.sourceFileId, fileId)).run();
  db.delete(sourceFiles).where(eq(sourceFiles.id, fileId)).run();
  fs.rmSync(file.path, { force: true });
  rebuildIfBuilt(db, file.propertyId);
}

export async function loadSample(): Promise<void> {
  const db = await getReadyDb();
  await importSampleData(db);
  (await cookies()).set(PROPERTY_COOKIE, SAMPLE_PROPERTY_ID, cookieOptions);
  revalidatePath("/", "layout");
}

export async function saveMapping(fileId: string, sheet: string, mapping: Record<string, string>): Promise<void> {
  const db = await getReadyDb();
  const file = db.select().from(sourceFiles).where(eq(sourceFiles.id, fileId)).get();
  if (!file) return;
  remapTable(db, fileId, sheet, mapping);
  rebuildIfBuilt(db, file.propertyId);
}

export async function reviewRow(rowId: string, decision: "accept" | "reject" | "fix", fixes: Record<string, string> = {}): Promise<{ error?: string }> {
  const db = await getReadyDb();
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
  rebuildIfBuilt(db, row.propertyId);
  return {};
}

export async function resolveConflict(conflictId: string, value: string): Promise<void> {
  const db = await getReadyDb();
  const c = db.select().from(conflicts).where(eq(conflicts.id, conflictId)).get();
  if (!c) return;
  db.insert(resolutions).values({ key: conflictId, value }).onConflictDoUpdate({ target: resolutions.key, set: { value, decidedAt: new Date().toISOString() } }).run();
  rebuildIfBuilt(db, c.propertyId);
}

/** The owner tells Tally which unit an unmatched deposit belongs to. */
export async function assignDeposit(stagedRowId: string, unit: string): Promise<{ error?: string }> {
  const db = await getReadyDb();
  const row = db.select().from(stagedRows).where(eq(stagedRows.id, stagedRowId)).get();
  if (!row) return { error: "That deposit no longer exists." };
  const u = unit.trim().toUpperCase();
  const known = db.select().from(units).where(and(eq(units.propertyId, row.propertyId), eq(units.number, u))).get();
  if (!known) return { error: `There's no unit ${unit} on the rent roll.` };
  const data = { ...row.data, memo: { value: `UNIT ${u} (assigned by owner)`, confidence: 1 } };
  db.update(stagedRows).set({ data, status: "fixed" }).where(eq(stagedRows.id, stagedRowId)).run();
  rebuildIfBuilt(db, row.propertyId);
  return {};
}

export async function buildNow(): Promise<void> {
  const { db, propertyId } = await targetProperty();
  buildRentRoll(db, propertyId);
  revalidatePath("/", "layout");
  redirect(`/property/${propertyId}`);
}

// ---------- properties ----------
export async function createProperty(formData: FormData): Promise<void> {
  const name = String(formData.get("name") ?? "").trim().slice(0, 80);
  if (!name) return;
  const db = await getReadyDb();
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "property";
  let id = base;
  for (let n = 2; db.select().from(properties).where(eq(properties.id, id)).get(); n++) id = `${base}-${n}`;
  db.insert(properties).values({ id, name }).run();
  (await cookies()).set(PROPERTY_COOKIE, id, cookieOptions);
  revalidatePath("/", "layout");
  redirect("/import");
}

export async function switchProperty(id: string): Promise<void> {
  const db = await getReadyDb();
  const p = db.select().from(properties).where(eq(properties.id, id)).get();
  if (!p) return;
  (await cookies()).set(PROPERTY_COOKIE, id, cookieOptions);
  revalidatePath("/", "layout");
  redirect(p.unitCount > 0 ? `/property/${id}` : "/import");
}

function deletePropertyRows(db: DB, id: string) {
  for (const file of db.select().from(sourceFiles).where(eq(sourceFiles.propertyId, id)).all()) fs.rmSync(file.path, { force: true });
  for (const t of [units, leases, charges, payments, conflicts, fieldProvenance, notices, promises, comps, stagedRows, sourceFiles]) {
    db.delete(t).where(eq(t.propertyId, id)).run();
  }
  for (const r of db.select().from(resolutions).all()) if (r.key.startsWith(`${id}|`)) db.delete(resolutions).where(eq(resolutions.key, r.key)).run();
  db.delete(properties).where(eq(properties.id, id)).run();
}

export async function deleteProperty(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const db = await getReadyDb();
  deletePropertyRows(db, id);
  (await cookies()).delete(PROPERTY_COOKIE);
  revalidatePath("/", "layout");
  redirect("/settings?deleted=1");
}

/** Erase everything in this workspace: every property, file, letter and setting. */
export async function deleteAllData(): Promise<void> {
  wipeDb(await getReadyDb());
  (await cookies()).delete(PROPERTY_COOKIE);
  revalidatePath("/", "layout");
  redirect("/?erased=1");
}

// ---------- the owner's own AI key ----------
/**
 * Check a key with the provider, then keep it in an httpOnly cookie in this
 * browser. It is never written to the database and never sent back to the page.
 */
export async function saveAiKey(provider: AIProviderName, apiKey: string, model: string): Promise<{ error?: string; ok?: string }> {
  const key = apiKey.trim();
  if (provider !== "openai" && provider !== "xai") return { error: "Choose a provider." };
  if (key.length < 20 || /\s/.test(key)) return { error: "That doesn't look like an API key." };
  const base = (provider === "openai" ? process.env.OPENAI_BASE_URL : process.env.XAI_BASE_URL) ?? BASE_URLS[provider];
  try {
    const res = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) });
    if ([400, 401, 403].includes(res.status)) return { error: "The provider rejected that key. Check that it was copied in full and is still active." };
    if (!res.ok) return { error: `The provider returned an error (${res.status}). Try again in a minute.` };
  } catch {
    return { error: "Tally couldn't reach the provider to check the key. Check your connection and try again." };
  }
  const chosen = model.trim().slice(0, 60);
  (await cookies()).set(AI_COOKIE, JSON.stringify({ provider, apiKey: key, ...(chosen ? { model: chosen } : {}) }), cookieOptions);
  revalidatePath("/", "layout");
  return { ok: `Key saved. Tally will use ${provider === "openai" ? "OpenAI" : "xAI"} (${chosen || DEFAULT_MODELS[provider]}) from this browser.` };
}

export async function clearAiKey(): Promise<void> {
  (await cookies()).delete(AI_COOKIE);
  revalidatePath("/", "layout");
}

export async function updateSettings(formData: FormData): Promise<void> {
  const { db, current: p } = await getProperties();
  if (!p) return;
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
  ctx.db.insert(notices).values({
    id, propertyId: ctx.data.property.id, unitNumber: ctx.data.unitNumberOf(lease.id), resident: lease.residents.join(" & "), type: input.type,
    language: input.language, body: input.body, amount: input.amount, status: "approved", approvedBy: ctx.data.settings.ownerName,
    approvedAt: new Date().toISOString(), sourceId: null, confidence: 1,
  }).run();
  revalidatePath("/delinquency");
  return { id };
}

export async function markSent(noticeId: string, method: string): Promise<void> {
  (await getReadyDb()).update(notices).set({ status: "sent", method, sentAt: new Date().toISOString() }).where(eq(notices.id, noticeId)).run();
  revalidatePath("/delinquency");
}

export async function addPromise(unitNumber: string, amountRaw: string, dateRaw: string, note: string): Promise<{ error?: string }> {
  const ctx = await getContext();
  if (!ctx) return { error: "No rent roll yet." };
  const amount = parseMoney(amountRaw);
  const date = parseDate(dateRaw);
  if (amount == null || amount <= 0) return { error: "Enter the amount promised." };
  if (!date) return { error: "Enter the date promised." };
  ctx.db.insert(promises).values({ id: crypto.randomUUID(), propertyId: ctx.data.property.id, unitNumber, amount, promisedFor: date, note }).run();
  revalidatePath("/delinquency");
  return {};
}

export async function askQuestion(question: string): Promise<Answer> {
  const ctx = await getContext();
  if (!ctx) return { text: "I don't know — there's no rent roll yet. Add your data first.", citations: [], tool: null };
  return askTally(question, ctx.data, ctx.a);
}
