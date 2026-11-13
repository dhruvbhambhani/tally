/** Read the canonical tables into the pure domain objects the metric functions take. */
import { eq } from "drizzle-orm";
import type { DB } from "../db/client";
import {
  charges, conflicts, fieldProvenance, leases, notices, payments, promises, properties, sourceFiles, stagedRows, units,
} from "../db/schema";
import type { Charge, Lease, LateFeePolicy, Payment, Snapshot, Unit } from "../domain/types";
import { resolveSettings, type Settings } from "../settings";

export type PropertyRow = typeof properties.$inferSelect;
export type PaymentRow = typeof payments.$inferSelect;
export type LeaseRow = typeof leases.$inferSelect;

export interface PropertyData {
  property: PropertyRow;
  settings: Settings;
  policy: LateFeePolicy;
  snapshot: Snapshot;
  unitById: Map<string, Unit>;
  leaseById: Map<string, Lease>;
  leaseRows: Map<string, LeaseRow>;
  /** lease id → unit number */
  unitNumberOf: (leaseId: string) => string;
  paymentRows: PaymentRow[];
  unmatched: PaymentRow[];
}

export function listProperties(db: DB): PropertyRow[] {
  return db.select().from(properties).all().sort((a, b) => a.name.localeCompare(b.name));
}

/** The property the screens show: the one the owner picked, else the first with a built rent roll. */
export function primaryProperty(db: DB, preferredId?: string | null): PropertyRow | null {
  const all = listProperties(db);
  return all.find((p) => p.id === preferredId) ?? all.find((p) => p.unitCount > 0) ?? all[0] ?? null;
}

export function loadProperty(db: DB, propertyId: string): PropertyData | null {
  const property = db.select().from(properties).where(eq(properties.id, propertyId)).get();
  if (!property || !property.asOf) return null;
  const unitRows = db.select().from(units).where(eq(units.propertyId, propertyId)).all();
  if (!unitRows.length) return null;
  const leaseRowList = db.select().from(leases).where(eq(leases.propertyId, propertyId)).all();
  const chargeRows = db.select().from(charges).where(eq(charges.propertyId, propertyId)).all();
  const paymentRows = db.select().from(payments).where(eq(payments.propertyId, propertyId)).all();

  const domainUnits: Unit[] = unitRows
    .map((u) => ({ id: u.id, number: u.number, unitType: u.unitType, beds: u.beds, baths: u.baths, sqft: u.sqft, status: u.status, marketRent: u.marketRent, vacantSince: u.vacantSince }))
    .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
  const domainLeases: Lease[] = leaseRowList.map((l) => ({
    id: l.id, unitId: l.unitId, residents: l.residents, start: l.start, end: l.end, mtm: l.mtm, contractRent: l.contractRent,
    recurring: l.recurring as Lease["recurring"], concessions: l.concessions, depositHeld: l.depositHeld, depositRequired: l.depositRequired,
    subsidy: l.subsidy, lateFeeAuthorized: l.lateFeeAuthorized, mtmPremium: l.mtmPremium,
  }));
  const domainCharges: Charge[] = chargeRows.map((c) => ({ id: c.id, leaseId: c.leaseId, type: c.type as Charge["type"], amount: c.amount, dueDate: c.dueDate, period: c.period, payer: c.payer }));
  const domainPayments: Payment[] = paymentRows.map((p) => ({ id: p.id, leaseId: p.leaseId, amount: p.amount, date: p.date, payer: p.payer, memo: p.memo, method: p.method, payerType: p.payerType }));

  const unitById = new Map(domainUnits.map((u) => [u.id, u]));
  const leaseById = new Map(domainLeases.map((l) => [l.id, l]));
  return {
    property,
    settings: resolveSettings(property.settings),
    policy: { graceDay: property.lateFeeGraceDay, amount: property.lateFeeAmount },
    snapshot: { asOf: property.asOf, units: domainUnits, leases: domainLeases, charges: domainCharges, payments: domainPayments },
    unitById, leaseById,
    leaseRows: new Map(leaseRowList.map((l) => [l.id, l])),
    unitNumberOf: (leaseId) => unitById.get(leaseById.get(leaseId)?.unitId ?? "")?.number ?? "?",
    paymentRows,
    unmatched: paymentRows.filter((p) => !p.leaseId),
  };
}

// ---------- data health ----------
export interface DataHealth {
  score: number;
  fields: number;
  verified: number;
  verifiedShare: number;
  needsAttention: number;
  openConflicts: number;
  unmatchedDeposits: number;
  reviewItems: number;
  files: number;
}

export function dataHealth(db: DB, propertyId: string): DataHealth {
  const prov = db.select().from(fieldProvenance).where(eq(fieldProvenance.propertyId, propertyId)).all();
  const openConflicts = db.select().from(conflicts).where(eq(conflicts.propertyId, propertyId)).all().filter((c) => c.status === "open").length;
  const unmatched = db.select().from(payments).where(eq(payments.propertyId, propertyId)).all().filter((p) => !p.leaseId).length;
  const review = db.select().from(stagedRows).where(eq(stagedRows.propertyId, propertyId)).all().filter((r) => r.status === "needs_review").length;
  const files = db.select().from(sourceFiles).where(eq(sourceFiles.propertyId, propertyId)).all().length;
  const verified = prov.filter((p) => p.verified).length;
  const needsAttention = prov.filter((p) => !p.verified && p.confidence < 0.8).length;
  const fields = prov.length;
  const base = fields ? 100 * (1 - needsAttention / fields) : 0;
  // Starts at the share of fields read confidently; each open conflict costs 2 points, each unmatched deposit or review item 1.
  const score = Math.max(0, Math.round(base - 2 * openConflicts - unmatched - review));
  return { score, fields, verified, verifiedShare: fields ? verified / fields : 0, needsAttention, openConflicts, unmatchedDeposits: unmatched, reviewItems: review, files };
}

export function listNotices(db: DB, propertyId: string) {
  return db.select().from(notices).where(eq(notices.propertyId, propertyId)).all().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function listPromises(db: DB, propertyId: string) {
  return db.select().from(promises).where(eq(promises.propertyId, propertyId)).all();
}
