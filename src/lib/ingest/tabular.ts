/**
 * Reading spreadsheets and CSV exports: find the header row, work out what kind
 * of table it is, suggest a column mapping, and turn rows into typed fields.
 */
import crypto from "node:crypto";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { parseDate } from "../dates";
import type { StagedField } from "../db/schema";
import { parseMoney } from "../money";

export type TableKind = "rent_roll" | "payment" | "late_fee" | "bank_txn" | "unknown";

export interface RawTable {
  sheet: string;
  /** every row of the sheet, as displayed text */
  rows: string[][];
}

export function readCsv(buf: Buffer): RawTable[] {
  const text = buf.toString("utf8").replace(/^﻿/, "");
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: false });
  return [{ sheet: "CSV", rows: parsed.data.map((r) => r.map((c) => String(c ?? "").trim())) }];
}

export function readXlsx(buf: Buffer): RawTable[] {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  return wb.SheetNames.map((name) => {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true, defval: "" });
    return {
      sheet: name,
      rows: rows.map((r) =>
        (r as unknown[]).map((c) => (c instanceof Date ? c.toISOString().slice(0, 10) : String(c ?? "").trim())),
      ),
    };
  });
}

// ---- canonical fields and the header names owners / PMS exports use for them ----
export const FIELD_LABELS: Record<string, string> = {
  unit: "Unit", unitType: "Unit type", sqft: "Square feet", status: "Status", tenant: "Resident name", marketRent: "Market rent",
  rent: "Rent", pet: "Pet fee", parking: "Parking", storage: "Storage", utilities: "Utility bill-back", concession: "Discount",
  concessionEnds: "Discount ends", subsidy: "Voucher portion", deposit: "Deposit held", leaseStart: "Lease start", leaseEnd: "Lease end",
  moveIn: "Move-in", vacantSince: "Vacant since", notes: "Notes", hasPet: "Has a pet", date: "Date", amount: "Amount",
  method: "How paid", description: "Description", note: "Note",
};

const SYNONYMS: Record<string, string[]> = {
  unit: ["unit", "apt", "apt #", "apartment", "unit #", "unit number", "unit no", "space", "door", "unit name", "unit id", "bldg/unit", "bldg-unit", "apt no", "apartment #", "suite", "unit/apt"],
  unitType: ["bd/ba", "unit type", "type", "floorplan", "floor plan", "bed/bath", "beds/baths", "floorplan name", "unit type code", "br/ba", "bd / ba", "beds / baths", "bedrooms/bathrooms"],
  sqft: ["sq. ft.", "sqft", "sq ft", "square feet", "sf", "area", "unit sq ft", "unit sqft", "sqft.", "square footage", "sq. feet", "sq feet"],
  status: ["status", "unit status", "occupancy", "occupancy status", "lease status", "unit/lease status", "unit occupancy"],
  tenant: ["tenant", "resident", "name", "tenant name", "resident name", "residents", "tenants", "lessee", "occupant", "tenant(s)", "resident(s)", "primary tenant", "lessee name", "occupant name", "lease name", "resident names"],
  marketRent: ["market rent", "market", "mkt rent", "asking rent", "market rent amount", "mkt", "listed rent", "market"],
  rent: ["rent", "rent amt", "contract rent", "lease rent", "monthly rent", "actual rent", "current rent", "rent amount", "scheduled rent", "rent charge", "effective rent", "base rent", "lease charges", "charge amount"],
  pet: ["pet rent", "pet fee", "pet charge"],
  parking: ["parking", "garage", "carport", "parking fee"],
  storage: ["storage", "storage fee"],
  utilities: ["utility bill-back", "utility billback", "rubs", "utilities", "utility", "water/sewer"],
  concession: ["concession", "concessions", "discount", "special"],
  concessionEnds: ["concession ends", "concession end", "discount ends"],
  subsidy: ["subsidy", "hap", "voucher", "housing assistance", "section 8"],
  deposit: ["deposit", "dep", "security deposit", "sec dep", "deposit held", "resident deposit", "deposits held", "security deposits", "deposit on hand", "total deposits", "other deposit"],
  leaseStart: ["lease from", "lease start", "start", "start date", "lease begin", "lease start date", "lease begin date", "lease from date", "start of lease"],
  leaseEnd: ["lease to", "lease end", "lease exp", "expiration", "end date", "lease expiration", "expires", "lease expires", "lease end date", "lease expiration date", "lease to date", "end of lease", "expiration date", "lease exp date"],
  moveIn: ["move-in", "move in", "moved in", "move in date", "move-in date", "movein", "move in date"],
  vacantSince: ["vacant since", "vacated", "move-out", "move out", "move-out date", "move out date"],
  notes: ["notes", "comments", "comment"],
  hasPet: ["pet?", "pets?", "pet", "pets"],
  date: ["date", "posting date", "post date", "transaction date", "paid on", "date paid", "trans date"],
  amount: ["amount", "amt", "paid", "payment", "late fee", "credit", "deposit amount"],
  method: ["how", "method", "pay type", "paid by", "payment method"],
  description: ["description", "details", "transaction description"],
  note: ["note", "memo"],
};

const KIND_FIELDS: Record<Exclude<TableKind, "unknown">, string[]> = {
  rent_roll: ["unit", "unitType", "sqft", "status", "tenant", "marketRent", "rent", "pet", "parking", "storage", "utilities", "concession", "concessionEnds", "subsidy", "deposit", "leaseStart", "leaseEnd", "moveIn", "vacantSince", "notes", "hasPet"],
  payment: ["date", "unit", "amount", "method", "note"],
  late_fee: ["date", "unit", "amount"],
  bank_txn: ["date", "description", "amount"],
};
export const fieldsForKind = (k: TableKind): string[] => (k === "unknown" ? [] : KIND_FIELDS[k]);

const norm = (h: string) => h.toLowerCase().replace(/\s+/g, " ").trim();
const ALL_SYNONYMS = new Set(Object.values(SYNONYMS).flat());

/** The header row is the first row where at least 3 cells are recognizable column names. */
export function findHeaderRow(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const hits = rows[i].filter((c) => ALL_SYNONYMS.has(norm(c))).length;
    if (hits >= 3) return i;
  }
  return -1;
}

export function suggestMapping(headers: string[], kind: TableKind): Record<string, string> {
  const mapping: Record<string, string> = {};
  const used = new Set<string>();
  // Yardi-style exports have a "Resident" code column next to a "Name" column: the name is the person.
  const nameCol = headers.find((h) => norm(h) === "name");
  if (kind === "rent_roll" && nameCol && headers.some((h) => norm(h) === "resident")) {
    mapping.tenant = nameCol;
    used.add(nameCol);
  }
  for (const field of fieldsForKind(kind)) {
    if (mapping[field]) continue;
    for (const syn of SYNONYMS[field] ?? []) {
      const h = headers.find((x) => norm(x) === syn && !used.has(x));
      if (h) {
        mapping[field] = h;
        used.add(h);
        break;
      }
    }
  }
  return mapping;
}

export function classifyTable(headers: string[], sheetName: string): TableKind {
  const has = (field: string) => headers.some((h) => (SYNONYMS[field] ?? []).includes(norm(h)));
  if (has("unit") && (has("tenant") || has("rent") || has("marketRent")) && !has("date")) return "rent_roll";
  if (has("date") && has("unit") && (has("amount") || headers.some((h) => /late fee/i.test(h)))) {
    return /late/i.test(sheetName) || headers.some((h) => /late fee/i.test(h)) ? "late_fee" : "payment";
  }
  if (has("date") && has("description") && has("amount")) return "bank_txn";
  return "unknown";
}

export function headerSignature(headers: string[], kind: TableKind): string {
  return crypto.createHash("sha1").update(kind + "|" + headers.map(norm).join("|")).digest("hex").slice(0, 16);
}

// ---- typed parsing ----
const MONEY_FIELDS = new Set(["marketRent", "rent", "pet", "parking", "storage", "utilities", "concession", "subsidy", "deposit", "amount"]);
const DATE_FIELDS = new Set(["leaseStart", "leaseEnd", "moveIn", "vacantSince", "concessionEnds", "date"]);

export function parseStatus(raw: string, tenant: string): string | null {
  const s = (raw || "").toLowerCase();
  if (/no notice/.test(s)) return "occupied";
  if (/notice/.test(s)) return "notice";
  if (/vacant/.test(s) || /^vacant$/i.test(tenant.trim())) return "vacant";
  if (/down|offline/.test(s)) return "down";
  if (/model/.test(s)) return "model";
  if (/employee|staff/.test(s)) return "employee";
  if (/current|occupied|rented|leased/.test(s)) return "occupied";
  return null;
}

export function parseUnitType(raw: string): { unitType: string; beds: number; baths: number } | null {
  const s = raw.trim();
  if (!s) return null;
  if (/studio|^0\s*\/\s*1$/i.test(s)) return { unitType: "Studio", beds: 0, baths: 1 };
  const m = s.match(/^(\d)(?:\s*(?:br|bd|bed)s?)?\s*[/x]\s*(\d(?:\.5)?)(?:\s*ba)?$/i);
  if (m) return { unitType: `${m[1]}BR/${m[2]}BA`, beds: +m[1], baths: +m[2] };
  return { unitType: s, beds: 0, baths: 0 };
}

export function splitNames(raw: string): string[] {
  return raw.split(/\s*(?:,|\/|&|;|\band\b)\s*/i).map((s) => s.trim()).filter(Boolean);
}

export interface ParsedRow {
  data: Record<string, StagedField>;
  /** plain-English problems found while parsing (e.g. an impossible date) */
  problems: string[];
}

/** Turn one spreadsheet row into typed fields. Unparseable cells become null + a problem, never a guess. */
export function parseRow(row: string[], headers: string[], mapping: Record<string, string>): ParsedRow {
  const data: Record<string, StagedField> = {};
  const problems: string[] = [];
  const get = (field: string) => {
    const idx = headers.indexOf(mapping[field]);
    return idx >= 0 ? (row[idx] ?? "").trim() : "";
  };
  for (const field of Object.keys(mapping)) {
    const raw = get(field);
    if (raw === "") continue;
    if (MONEY_FIELDS.has(field)) {
      const v = parseMoney(raw);
      if (v == null) problems.push(`${FIELD_LABELS[field]} "${raw}" isn't an amount`);
      data[field] = { value: v, raw, confidence: v == null ? 0 : 1 };
    } else if (DATE_FIELDS.has(field)) {
      if (field === "leaseEnd" && /^(mtm|m2m|month.to.month)$/i.test(raw)) {
        data.mtm = { value: true, raw, confidence: 1 };
        continue;
      }
      const v = parseDate(/^\d+$/.test(raw) ? Number(raw) : raw);
      if (v == null) problems.push(`${FIELD_LABELS[field]} "${raw}" isn't a real date`);
      data[field] = { value: v, raw, confidence: v == null ? 0 : 1 };
    } else if (field === "sqft") {
      const v = Number(raw.replace(/,/g, ""));
      data[field] = { value: isFinite(v) ? v : null, raw, confidence: isFinite(v) ? 1 : 0 };
    } else if (field === "hasPet") {
      data[field] = { value: /^(y|yes|true|x|1)/i.test(raw), raw, confidence: 1 };
    } else if (field === "unit") {
      data[field] = { value: raw.replace(/^(unit|apt\.?|#)\s*/i, "").replace(/\.0$/, ""), raw, confidence: 1 };
    } else {
      data[field] = { value: raw, raw, confidence: 1 };
    }
  }
  return { data, problems };
}

/** "ZELLE PAYMENT FROM JANE DOE MEMO: RENT 4B" → payer + memo. */
export function parseBankDescription(desc: string): { payer: string; memo: string; method: string } {
  const memo = desc.match(/MEMO:\s*(.+)$/i)?.[1]?.trim() ?? "";
  const head = desc.replace(/\s*MEMO:.*$/i, "");
  let payer = "";
  let m = head.match(/\bFROM\s+(.+)$/i);
  if (m) payer = m[1];
  else if ((m = head.match(/ACH (?:CREDIT|DEPOSIT)\s+(.+?)(?:\s+RENT)?$/i))) payer = m[1];
  const method = /zelle/i.test(head) ? "Zelle" : /venmo/i.test(head) ? "Venmo" : /cash app/i.test(head) ? "Cash App" : /ach/i.test(head) ? "ACH" : /check/i.test(head) ? "Check" : /cash/i.test(head) ? "Cash" : "Deposit";
  return { payer: payer.trim(), memo, method };
}
