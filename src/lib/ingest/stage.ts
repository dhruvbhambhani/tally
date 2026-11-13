/**
 * Ingestion: detect what a file is, extract its rows with provenance and
 * per-field confidence, and stage them for review. Nothing here touches the
 * canonical rent roll — that happens in /lib/reconcile when the owner builds it.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getProvider } from "../ai/provider";
import { dataDirOf, type DB } from "../db/client";
import { columnMappings, sourceFiles, stagedRows, type StagedField } from "../db/schema";
import { parseDate } from "../dates";
import {
  classifyTable, findHeaderRow, headerSignature, parseBankDescription, parseRow, readCsv, readXlsx, suggestMapping,
  type RawTable, type TableKind,
} from "./tabular";

export const REVIEW_THRESHOLD = 0.8;

export type FileKind = "pms_rent_roll" | "spreadsheet" | "bank" | "lease" | "ledger_image" | "unknown";

export const KIND_LABELS: Record<FileKind, string> = {
  pms_rent_roll: "Rent roll export",
  spreadsheet: "Spreadsheet",
  bank: "Bank or payment-app statement",
  lease: "Lease",
  ledger_image: "Handwritten ledger",
  unknown: "Not recognized",
};

export interface TableMeta {
  sheet: string;
  kind: TableKind;
  headers: string[];
  headerRow: number;
  mapping: Record<string, string>;
  signature: string;
  rows: number;
  remembered: boolean;
}

type NewStaged = typeof stagedRows.$inferInsert;

function ext(name: string) {
  return path.extname(name).toLowerCase();
}

async function pdfText(buf: Buffer): Promise<{ text: string; pages: number }> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { totalPages, text } = await extractText(pdf, { mergePages: true });
  return { text: Array.isArray(text) ? text.join("\n") : text, pages: totalPages };
}

function stageTables(
  db: DB, fileId: string, propertyId: string, tables: RawTable[], override?: { sheet: string; mapping: Record<string, string> },
): { rows: NewStaged[]; metas: TableMeta[]; preamble: string[]; moneyOut: number } {
  const rows: NewStaged[] = [];
  const metas: TableMeta[] = [];
  let preamble: string[] = [];
  let moneyOut = 0;
  tables.forEach((t, ti) => {
    const headerRow = findHeaderRow(t.rows);
    if (headerRow < 0) {
      metas.push({ sheet: t.sheet, kind: "unknown", headers: [], headerRow: -1, mapping: {}, signature: "", rows: 0, remembered: false });
      return;
    }
    const headers = t.rows[headerRow];
    const kind = classifyTable(headers, t.sheet);
    const signature = headerSignature(headers, kind);
    const saved = db.select().from(columnMappings).where(eq(columnMappings.signature, signature)).get();
    const mapping = override?.sheet === t.sheet ? override.mapping : (saved?.mapping ?? suggestMapping(headers, kind));
    if (ti === 0) preamble = t.rows.slice(0, headerRow).map((r) => r.filter(Boolean).join(" ")).filter(Boolean);
    let count = 0;
    const seenUnits = new Map<string, number>();
    for (let i = headerRow + 1; i < t.rows.length; i++) {
      const raw = t.rows[i];
      if (!raw.some((c) => c !== "")) continue;
      const { data, problems } = parseRow(raw, headers, mapping);
      const locator = { sheet: t.sheet, row: i + 1 };
      const id = `${fileId}:${ti}:${i}`;
      let status: NewStaged["status"] = problems.length ? "needs_review" : "ok";
      let reason: string | null = problems.join("; ") || null;

      if (kind === "rent_roll") {
        const unit = String(data.unit?.value ?? "");
        if (!unit || !/^[A-Za-z0-9-]{1,8}$/.test(unit) || /^total$/i.test(unit)) continue; // totals / blank lines
        const first = seenUnits.get(unit);
        if (first != null) {
          status = "needs_review";
          reason = `Unit ${unit} appears twice in this file (rows ${first} and ${i + 1}). Tally is using the first one.`;
          data.duplicateOf = { value: first, confidence: 1 };
        } else seenUnits.set(unit, i + 1);
        rows.push({ id, sourceFileId: fileId, propertyId, kind: "rent_roll", locator, data, status, reviewReason: reason, ord: i });
      } else if (kind === "payment" || kind === "late_fee") {
        if (data.unit?.value == null || data.amount?.value == null) continue;
        rows.push({ id, sourceFileId: fileId, propertyId, kind, locator, data, status, reviewReason: reason, ord: i });
      } else if (kind === "bank_txn") {
        const amount = data.amount?.value as number | null;
        if (amount == null) continue;
        if (amount <= 0) {
          moneyOut++;
          continue; // money going out is not a rent deposit
        }
        const parsed = parseBankDescription(String(data.description?.value ?? ""));
        data.payer = { value: parsed.payer, confidence: parsed.payer ? 0.95 : 0 };
        data.memo = { value: parsed.memo, confidence: 1 };
        data.method = { value: parsed.method, confidence: 1 };
        rows.push({ id, sourceFileId: fileId, propertyId, kind: "bank_txn", locator, data, status, reviewReason: reason, ord: i });
      } else continue;
      count++;
    }
    metas.push({ sheet: t.sheet, kind, headers, headerRow, mapping, signature, rows: count, remembered: !!saved });
  });
  return { rows, metas, preamble, moneyOut };
}

function detectTabularKind(metas: TableMeta[], name: string): FileKind {
  const kinds = metas.map((m) => m.kind);
  if (kinds.includes("bank_txn") && !kinds.includes("rent_roll")) return "bank";
  if (kinds.includes("rent_roll")) return ext(name) === ".csv" && metas.length === 1 ? "pms_rent_roll" : "spreadsheet";
  if (kinds.some((k) => k !== "unknown")) return "spreadsheet";
  return "unknown";
}

export interface IngestResult {
  fileId: string;
  name: string;
  kind: FileKind;
  rows: number;
  needsReview: number;
  note?: string;
}

export async function ingestFile(db: DB, propertyId: string, name: string, buf: Buffer, opts: { link?: string } = {}): Promise<IngestResult> {
  const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
  // the same file can be added to two properties, so the id covers both
  const fileId = crypto.createHash("sha256").update(propertyId + ":" + (opts.link ?? sha256)).digest("hex").slice(0, 12);
  const safe = name.replace(/[^\w.\-]+/g, "_");
  const filePath = path.join(dataDirOf(db), "uploads", `${fileId}-${safe}`);
  let stored = buf;
  const e = ext(name);

  let kind: FileKind = "unknown";
  let status: "parsed" | "unsupported" | "error" = "parsed";
  let rows: NewStaged[] = [];
  const meta: Record<string, unknown> = { sha256, ...(opts.link ? { link: opts.link, syncedAt: new Date().toISOString() } : {}) };
  let note: string | undefined;
  const provider = await getProvider();

  try {
    if (e === ".csv" || e === ".tsv" || e === ".txt" || e === ".xlsx" || e === ".xls") {
      const tables = e === ".xlsx" || e === ".xls" ? readXlsx(buf) : readCsv(buf);
      const staged = stageTables(db, fileId, propertyId, tables);
      rows = staged.rows;
      kind = detectTabularKind(staged.metas, name);
      meta.tables = staged.metas;
      meta.preamble = staged.preamble;
      meta.moneyOut = staged.moneyOut;
      const asOf = staged.preamble.map((l) => l.match(/as of:?\s*(.+)$/i)?.[1]).find(Boolean);
      if (asOf) meta.asOf = parseDate(asOf.trim());
      if (staged.preamble[1]) meta.title = staged.preamble[1];
      if (kind === "unknown") {
        status = "unsupported";
        note = "Tally couldn't find column headers it recognizes in this file.";
      }
    } else if (e === ".pdf") {
      const { text, pages } = await pdfText(buf);
      meta.pages = pages;
      if (/lease|tenancy|landlord/i.test(text) && /resident|tenant|lessee/i.test(text)) {
        kind = "lease";
        const res = await provider.extract({ task: "lease", text, fileName: name });
        const data: Record<string, StagedField> = {};
        for (const [k, c] of Object.entries(res.fields)) {
          if (c.value != null) data[k] = { value: c.value as StagedField["value"], raw: c.raw, confidence: c.confidence };
        }
        const missing = (["unit", "rent", "start", "end"] as const).filter((k) => res.fields[k].value == null);
        const low = Object.entries(data).filter(([, c]) => c.confidence < REVIEW_THRESHOLD).map(([k]) => k);
        const reason = missing.length ? `Couldn't find: ${missing.join(", ")}` : low.length ? `Not sure about: ${low.join(", ")}` : null;
        rows.push({ id: `${fileId}:0:0`, sourceFileId: fileId, propertyId, kind: "lease", locator: { page: 1 }, data, status: reason ? "needs_review" : "ok", reviewReason: reason, ord: 0 });
        if (res.note) note = res.note;
      } else if (text.trim().length < 40) {
        status = "unsupported";
        note = "This PDF looks like a scan with no text. Upload it as an image, or add an API key so Tally can read it.";
      } else {
        kind = "pms_rent_roll";
        status = "unsupported";
        note = provider.demo
          ? "Reading rent-roll tables out of a PDF needs an AI provider. Export it as CSV or Excel, or add an API key."
          : "PDF rent rolls aren't supported yet — export as CSV or Excel.";
      }
    } else if ([".jpg", ".jpeg", ".png", ".webp", ".heic", ".tif", ".tiff"].includes(e)) {
      kind = "ledger_image";
      const sharp = (await import("sharp")).default;
      // The stored/displayed image is auto-oriented so crop regions line up with what the model saw.
      const isSample = provider.demo;
      const oriented = isSample ? buf : await sharp(buf).rotate().jpeg({ quality: 88 }).toBuffer();
      stored = oriented;
      // What the model reads: upright, contrast-stretched, capped in size.
      const forModel = provider.demo ? buf : await sharp(oriented).normalize().resize({ width: 2000, withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
      const imgMeta = await sharp(stored).metadata();
      meta.width = imgMeta.width;
      meta.height = imgMeta.height;
      const res = await provider.extract({ task: "ledger_image", image: forModel, mime: "image/jpeg", fileName: name, sha256 });
      res.rows.forEach((r, i) => {
        const data: Record<string, StagedField> = {};
        for (const [k, c] of Object.entries(r.cells)) data[k] = { value: c.value, raw: c.raw, confidence: c.confidence };
        const low = Object.entries(r.cells).filter(([k, c]) => k !== "note" && (c.value == null || c.confidence < REVIEW_THRESHOLD)).map(([k]) => k);
        const reason = low.length ? `Hard to read: ${low.join(", ")}` : null;
        rows.push({ id: `${fileId}:0:${i}`, sourceFileId: fileId, propertyId, kind: "ledger", locator: { region: r.region }, data, status: reason ? "needs_review" : "ok", reviewReason: reason, ord: i });
      });
      if (res.note) {
        note = res.note;
        if (!res.rows.length) status = "unsupported";
      }
    } else {
      status = "unsupported";
      note = "Tally reads CSV, Excel, PDF and image files.";
    }
  } catch (err) {
    status = "error";
    note = `Couldn't read this file: ${(err as Error).message}`;
  }

  fs.writeFileSync(filePath, stored);
  if (note) meta.note = note;
  db.delete(stagedRows).where(eq(stagedRows.sourceFileId, fileId)).run();
  db.delete(sourceFiles).where(eq(sourceFiles.id, fileId)).run();
  db.insert(sourceFiles).values({ id: fileId, propertyId, name, kind, mime: e.slice(1), path: filePath, size: buf.length, status, meta }).run();
  for (let i = 0; i < rows.length; i += 200) db.insert(stagedRows).values(rows.slice(i, i + 200)).run();
  return { fileId, name, kind, rows: rows.length, needsReview: rows.filter((r) => r.status === "needs_review").length, note };
}

/** Re-read one sheet with a mapping the owner corrected, and remember it for next time. */
export function remapTable(db: DB, fileId: string, sheet: string, mapping: Record<string, string>): void {
  const file = db.select().from(sourceFiles).where(eq(sourceFiles.id, fileId)).get();
  if (!file) throw new Error("File not found");
  const buf = fs.readFileSync(file.path);
  const tables = /xlsx?$/.test(file.mime) ? readXlsx(buf) : readCsv(buf);
  const staged = stageTables(db, fileId, file.propertyId, tables, { sheet, mapping });
  const meta = { ...file.meta, tables: staged.metas };
  const table = staged.metas.find((m) => m.sheet === sheet);
  if (table) {
    db.insert(columnMappings).values({ signature: table.signature, kind: table.kind, mapping })
      .onConflictDoUpdate({ target: columnMappings.signature, set: { mapping, updatedAt: new Date().toISOString() } }).run();
  }
  db.delete(stagedRows).where(eq(stagedRows.sourceFileId, fileId)).run();
  for (let i = 0; i < staged.rows.length; i += 200) db.insert(stagedRows).values(staged.rows.slice(i, i + 200)).run();
  db.update(sourceFiles).set({ meta }).where(eq(sourceFiles.id, fileId)).run();
}
