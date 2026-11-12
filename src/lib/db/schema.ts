import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text, index } from "drizzle-orm/sqlite-core";

/**
 * Canonical model: Property → Unit → Lease → Charges & Payments → Notices.
 *
 * Provenance: every canonical row carries `sourceId` + `confidence` for the row
 * as a whole, and `field_provenance` holds the same pair for each individual
 * field (plus where in the file it came from). Money is integer cents.
 */
const provenance = {
  sourceId: text("source_id"),
  confidence: real("confidence").notNull().default(1),
};

export const properties = sqliteTable("properties", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  address: text("address").notNull().default(""),
  city: text("city").notNull().default(""),
  state: text("state").notNull().default(""),
  unitCount: integer("unit_count").notNull().default(0),
  caresCovered: text("cares_covered", { enum: ["yes", "no", "unknown"] }).notNull().default("unknown"),
  rentControl: integer("rent_control", { mode: "boolean" }).notNull().default(false),
  /** yearly cap on increases when rent control applies, percent */
  rentControlCapPct: real("rent_control_cap_pct"),
  /** owner's own ceiling on any renewal increase, percent */
  maxIncreasePct: real("max_increase_pct").notNull().default(8),
  /** off where local law restricts algorithmic rent-setting */
  pricingSuggestions: integer("pricing_suggestions", { mode: "boolean" }).notNull().default(true),
  lateFeeGraceDay: integer("late_fee_grace_day").notNull().default(5),
  lateFeeAmount: integer("late_fee_amount").notNull().default(5000),
  /** the date the data is current through; all "today" math uses this */
  asOf: text("as_of"),
  /** ladder, benchmark ranges, rental-assistance text, thresholds (JSON) */
  settings: text("settings", { mode: "json" }).$type<Record<string, unknown>>().notNull().default(sql`'{}'`),
  ...provenance,
});

export const sourceFiles = sqliteTable("source_files", {
  id: text("id").primaryKey(),
  propertyId: text("property_id").notNull(),
  name: text("name").notNull(),
  /** detected type: pms_rent_roll | spreadsheet | bank | lease | ledger_image | unknown */
  kind: text("kind").notNull(),
  mime: text("mime").notNull().default(""),
  path: text("path").notNull(),
  size: integer("size").notNull().default(0),
  status: text("status", { enum: ["parsed", "needs_mapping", "unsupported", "error"] }).notNull().default("parsed"),
  /** detection notes, sheet list, applied column mapping, page count (JSON) */
  meta: text("meta", { mode: "json" }).$type<Record<string, unknown>>().notNull().default(sql`'{}'`),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

/** One extracted record (a spreadsheet row, a deposit, a ledger line, a lease abstract) before merging. */
export const stagedRows = sqliteTable(
  "staged_rows",
  {
    id: text("id").primaryKey(),
    sourceFileId: text("source_file_id").notNull(),
    propertyId: text("property_id").notNull(),
    /** rent_roll | tenant | payment | late_fee | bank_txn | ledger | lease */
    kind: text("kind").notNull(),
    /** where it came from: { sheet, row } | { page } | { region: {x,y,w,h} } */
    locator: text("locator", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    /** field → { value, raw, confidence } */
    data: text("data", { mode: "json" }).$type<Record<string, StagedField>>().notNull(),
    status: text("status", { enum: ["ok", "needs_review", "accepted", "fixed", "rejected"] }).notNull().default("ok"),
    reviewReason: text("review_reason"),
    ord: integer("ord").notNull().default(0),
  },
  (t) => [index("staged_property_idx").on(t.propertyId), index("staged_file_idx").on(t.sourceFileId)],
);

export interface StagedField {
  value: string | number | boolean | null;
  raw?: string;
  confidence: number;
}

/** Remembered column mappings, keyed by the file's header signature. */
export const columnMappings = sqliteTable("column_mappings", {
  signature: text("signature").primaryKey(),
  kind: text("kind").notNull(),
  mapping: text("mapping", { mode: "json" }).$type<Record<string, string>>().notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const units = sqliteTable("units", {
  id: text("id").primaryKey(),
  propertyId: text("property_id").notNull(),
  number: text("number").notNull(),
  unitType: text("unit_type").notNull().default(""),
  beds: real("beds").notNull().default(0),
  baths: real("baths").notNull().default(0),
  sqft: integer("sqft").notNull().default(0),
  status: text("status", { enum: ["occupied", "vacant", "notice", "down", "model", "employee"] }).notNull(),
  marketRent: integer("market_rent").notNull().default(0),
  vacantSince: text("vacant_since"),
  ...provenance,
});

export const leases = sqliteTable("leases", {
  id: text("id").primaryKey(),
  propertyId: text("property_id").notNull(),
  unitId: text("unit_id").notNull(),
  residents: text("residents", { mode: "json" }).$type<string[]>().notNull(),
  start: text("start").notNull(),
  end: text("end"),
  mtm: integer("mtm", { mode: "boolean" }).notNull().default(false),
  contractRent: integer("contract_rent").notNull(),
  /** [{ type: pet|parking|storage|utilities|other, amount, billed }] */
  recurring: text("recurring", { mode: "json" }).$type<{ type: string; amount: number; billed: boolean }[]>().notNull(),
  /** [{ label, monthlyAmount, endsOn }] — endsOn is the burn-off date */
  concessions: text("concessions", { mode: "json" }).$type<{ label: string; monthlyAmount: number; endsOn: string }[]>().notNull(),
  depositHeld: integer("deposit_held").notNull().default(0),
  depositRequired: integer("deposit_required"),
  /** { tenantPortion, hapPortion, leaseTenantPortion, leaseHapPortion } */
  subsidy: text("subsidy", { mode: "json" }).$type<{ tenantPortion: number; hapPortion: number; leaseTenantPortion: number | null; leaseHapPortion: number | null } | null>(),
  lateFeeAuthorized: integer("late_fee_authorized", { mode: "boolean" }),
  mtmPremium: integer("mtm_premium"),
  notes: text("notes").notNull().default(""),
  ...provenance,
});

export const charges = sqliteTable(
  "charges",
  {
    id: text("id").primaryKey(),
    propertyId: text("property_id").notNull(),
    leaseId: text("lease_id").notNull(),
    type: text("type").notNull(),
    amount: integer("amount").notNull(),
    dueDate: text("due_date").notNull(),
    period: text("period").notNull(),
    payer: text("payer", { enum: ["tenant", "subsidy"] }).notNull().default("tenant"),
    ...provenance,
  },
  (t) => [index("charges_lease_idx").on(t.leaseId)],
);

export const payments = sqliteTable(
  "payments",
  {
    id: text("id").primaryKey(),
    propertyId: text("property_id").notNull(),
    /** null = deposit Tally could not match to a lease */
    leaseId: text("lease_id"),
    amount: integer("amount").notNull(),
    date: text("date").notNull(),
    payer: text("payer").notNull().default(""),
    memo: text("memo").notNull().default(""),
    method: text("method").notNull().default(""),
    payerType: text("payer_type", { enum: ["tenant", "subsidy"] }).notNull().default("tenant"),
    /** how the deposit was tied to the lease, in plain English */
    matchReason: text("match_reason").notNull().default(""),
    /** other source rows that show the same payment */
    corroboratedBy: text("corroborated_by", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    stagedRowId: text("staged_row_id"),
    ...provenance,
  },
  (t) => [index("payments_lease_idx").on(t.leaseId)],
);

/** Every letter or notice the owner approved, and how it went out. Nothing is sent by Tally. */
export const notices = sqliteTable("notices", {
  id: text("id").primaryKey(),
  propertyId: text("property_id").notNull(),
  unitNumber: text("unit_number").notNull(),
  resident: text("resident").notNull(),
  type: text("type").notNull(),
  language: text("language").notNull().default("en"),
  body: text("body").notNull(),
  amount: integer("amount"),
  status: text("status", { enum: ["draft", "approved", "sent"] }).notNull().default("draft"),
  method: text("method"),
  approvedBy: text("approved_by"),
  approvedAt: text("approved_at"),
  sentAt: text("sent_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  ...provenance,
});

/** Two sources disagree about a field. Never auto-resolved. */
export const conflicts = sqliteTable("conflicts", {
  id: text("id").primaryKey(),
  propertyId: text("property_id").notNull(),
  unitNumber: text("unit_number").notNull(),
  field: text("field").notNull(),
  /** [{ sourceId, sourceName, locator, value, display }] */
  candidates: text("candidates", { mode: "json" }).$type<ConflictCandidate[]>().notNull(),
  /** the value in use until the owner decides */
  workingValue: text("working_value"),
  status: text("status", { enum: ["open", "resolved"] }).notNull().default("open"),
  resolvedValue: text("resolved_value"),
});

export interface ConflictCandidate {
  sourceId: string;
  sourceName: string;
  stagedRowId?: string;
  value: string | number | null;
  display: string;
}

/** The owner's decisions (conflict picks), keyed so they survive a rebuild. */
export const resolutions = sqliteTable("resolutions", {
  key: text("key").primaryKey(), // `${propertyId}|${unitNumber}|${field}`
  value: text("value").notNull(),
  decidedAt: text("decided_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

/** Per-field provenance: which file, where in it, and how sure we are. */
export const fieldProvenance = sqliteTable(
  "field_provenance",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    propertyId: text("property_id").notNull(),
    entity: text("entity").notNull(), // unit | lease
    entityId: text("entity_id").notNull(),
    field: text("field").notNull(),
    sourceId: text("source_id").notNull(),
    stagedRowId: text("staged_row_id"),
    confidence: real("confidence").notNull(),
    /** verified = confirmed by a second source or by the owner */
    verified: integer("verified", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [index("prov_entity_idx").on(t.entityId)],
);

export const promises = sqliteTable("promises", {
  id: text("id").primaryKey(),
  propertyId: text("property_id").notNull(),
  unitNumber: text("unit_number").notNull(),
  amount: integer("amount").notNull(),
  promisedFor: text("promised_for").notNull(),
  note: text("note").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

/** Market comps the owner entered or imported from public listings. */
export const comps = sqliteTable("comps", {
  id: text("id").primaryKey(),
  propertyId: text("property_id").notNull(),
  unitType: text("unit_type").notNull(),
  rent: integer("rent").notNull(),
  source: text("source").notNull().default(""),
  note: text("note").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
