/**
 * Merge & reconcile: turn staged rows from every source into the canonical
 * rent roll. Deterministic. Sources that disagree create a conflict for the
 * owner (never auto-resolved); values that are hard to read stay flagged.
 */
import { and, eq, ne } from "drizzle-orm";
import { addDays, daysBetween, firstOfPeriod, periodOf, periodsBetween } from "../dates";
import type { DB } from "../db/client";
import {
  charges as chargesT, conflicts as conflictsT, fieldProvenance, leases as leasesT, payments as paymentsT, properties,
  resolutions, sourceFiles, stagedRows, units as unitsT, type ConflictCandidate, type StagedField,
} from "../db/schema";
import type { Charge, Lease, RecurringType } from "../domain/types";
import { parseStatus, parseUnitType, splitNames } from "../ingest/tabular";
import { money } from "../money";
import { chargesForMonth } from "../metrics/rentroll";
import { nameSimilarity } from "./names";
import { matchDeposits, type DepositInput, type LeaseTarget } from "./payments";

type Staged = typeof stagedRows.$inferSelect;
type SourceFile = typeof sourceFiles.$inferSelect;

interface Candidate {
  value: string | number | boolean | null;
  confidence: number;
  row: Staged;
  file: SourceFile;
}

const SOURCE_RANK: Record<string, number> = { pms_rent_roll: 0, spreadsheet: 1, lease: 2 };
/** Fields where two sources stating different values is a conflict the owner must settle. */
const CONFLICT_FIELDS: Record<string, string> = { rent: "Rent", leaseEnd: "Lease end", leaseStart: "Lease start", marketRent: "Market rent", deposit: "Deposit held" };
const DATE_FIELDS = new Set(["leaseEnd", "leaseStart"]);

export interface BuildSummary {
  propertyId: string;
  asOf: string;
  units: number;
  leases: number;
  payments: number;
  unmatchedDeposits: number;
  conflicts: number;
  corroborated: number;
}

const f = (row: Staged | undefined, key: string): StagedField | undefined => row?.data[key];
const val = <T = string | number | boolean | null>(row: Staged | undefined, key: string): T | null => (row?.data[key]?.value ?? null) as T | null;

function display(field: string, v: unknown): string {
  if (v == null) return "—";
  if (DATE_FIELDS.has(field)) return String(v);
  if (typeof v === "number") return money(v);
  return String(v);
}

export function buildRentRoll(db: DB, propertyId: string): BuildSummary {
  const property = db.select().from(properties).where(eq(properties.id, propertyId)).get();
  if (!property) throw new Error(`Unknown property ${propertyId}`);
  const files = db.select().from(sourceFiles).where(eq(sourceFiles.propertyId, propertyId)).all();
  const fileById = new Map(files.map((x) => [x.id, x]));
  const staged = db.select().from(stagedRows)
    .where(and(eq(stagedRows.propertyId, propertyId), ne(stagedRows.status, "rejected"))).all()
    .sort((a, b) => a.sourceFileId.localeCompare(b.sourceFileId) || a.ord - b.ord);
  const resolved = new Map(db.select().from(resolutions).all().map((r) => [r.key, r.value]));
  const ownerOk = (r: Staged) => r.status === "accepted" || r.status === "fixed";

  // ---------- as-of date: the latest dated activity in the data ----------
  let asOf = "";
  for (const r of staged) {
    if (r.kind === "bank_txn" || r.kind === "payment" || r.kind === "ledger") {
      const d = val<string>(r, "date");
      if (d && d > asOf) asOf = d;
    }
  }
  for (const file of files) {
    const a = file.meta.asOf as string | undefined;
    if (a && a > asOf) asOf = a;
  }
  if (!asOf) asOf = new Date().toISOString().slice(0, 10);

  // ---------- group rent-roll rows and lease abstracts by unit ----------
  const byUnit = new Map<string, { billing: Staged[]; lease?: Staged }>();
  const slot = (unit: string) => {
    if (!byUnit.has(unit)) byUnit.set(unit, { billing: [] });
    return byUnit.get(unit)!;
  };
  for (const r of staged) {
    const unit = String(val(r, "unit") ?? "").toUpperCase();
    if (!unit) continue;
    if (r.kind === "rent_roll" && r.data.duplicateOf == null) slot(unit).billing.push(r);
    if (r.kind === "lease") slot(unit).lease = r;
  }
  const rank = (r: Staged) => SOURCE_RANK[fileById.get(r.sourceFileId)?.kind ?? ""] ?? 9;

  const newUnits: (typeof unitsT.$inferInsert)[] = [];
  const newLeases: (typeof leasesT.$inferInsert)[] = [];
  const newConflicts: (typeof conflictsT.$inferInsert)[] = [];
  const prov: (typeof fieldProvenance.$inferInsert)[] = [];
  const domainLeases: (Lease & { unitNumber: string })[] = [];

  const unitNumbers = [...byUnit.keys()].filter((u) => byUnit.get(u)!.billing.length > 0)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  for (const unitNumber of unitNumbers) {
    const group = byUnit.get(unitNumber)!;
    const billing = [...group.billing].sort((a, b) => rank(a) - rank(b));
    const leaseDoc = group.lease;
    const unitId = `${propertyId}:U${unitNumber}`;
    const leaseId = `${propertyId}:L${unitNumber}`;

    /** All sources' values for a field, best source first. */
    const candidates = (field: string, leaseField?: string): Candidate[] => {
      const out: Candidate[] = [];
      for (const r of billing) {
        const c = f(r, field);
        if (c && c.value != null) out.push({ value: c.value, confidence: c.confidence, row: r, file: fileById.get(r.sourceFileId)! });
      }
      if (leaseDoc && leaseField) {
        const c = f(leaseDoc, leaseField);
        if (c && c.value != null) out.push({ value: c.value, confidence: c.confidence, row: leaseDoc, file: fileById.get(leaseDoc.sourceFileId)! });
      }
      return out;
    };

    /** Pick the working value, record provenance, and raise a conflict when sources disagree. */
    const pick = <T extends string | number | boolean>(entity: "unit" | "lease", field: string, leaseField?: string): T | null => {
      const cands = candidates(field, leaseField);
      if (!cands.length) return null;
      const key = `${propertyId}|${unitNumber}|${field}`;
      const distinct = [...new Set(cands.map((c) => String(c.value)))];
      let chosen = cands[0];
      let verified = distinct.length === 1 && (cands.length > 1 || ownerOk(cands[0].row));
      let value: string | number | boolean = chosen.value!;
      if (distinct.length > 1 && CONFLICT_FIELDS[field]) {
        const decision = resolved.get(key);
        const list: ConflictCandidate[] = cands.map((c) => ({
          sourceId: c.file.id, sourceName: c.file.name, stagedRowId: c.row.id, value: c.value as string | number, display: display(field, c.value),
        }));
        if (decision != null) {
          const match = cands.find((c) => String(c.value) === decision);
          if (match) chosen = match;
          value = match ? match.value! : typeof cands[0].value === "number" ? Number(decision) : decision;
          verified = true;
        }
        newConflicts.push({
          id: key, propertyId, unitNumber, field, candidates: list, workingValue: String(value),
          status: decision != null ? "resolved" : "open", resolvedValue: decision ?? null,
        });
      }
      prov.push({
        propertyId, entity, entityId: entity === "unit" ? unitId : leaseId, field,
        sourceId: chosen.file.id, stagedRowId: chosen.row.id, confidence: chosen.confidence, verified,
      });
      return value as T;
    };

    const main = billing[0];
    const tenantRaw = String(val(main, "tenant") ?? "");
    const status = (parseStatus(String(val(main, "status") ?? ""), tenantRaw) ?? (tenantRaw && !/^vacant$/i.test(tenantRaw) ? "occupied" : "vacant")) as
      "occupied" | "vacant" | "notice" | "down" | "model" | "employee";
    const ut = parseUnitType(String(pick("unit", "unitType") ?? ""));
    newUnits.push({
      id: unitId, propertyId, number: unitNumber, unitType: ut?.unitType ?? "", beds: ut?.beds ?? 0, baths: ut?.baths ?? 0,
      sqft: Number(pick("unit", "sqft") ?? 0), status, marketRent: Number(pick("unit", "marketRent") ?? 0),
      vacantSince: pick<string>("unit", "vacantSince"), sourceId: main.sourceFileId, confidence: 1,
    });
    if (status === "vacant" || status === "down" || status === "model") continue;

    // ----- residents: entity resolution across sources -----
    const nameCands = candidates("tenant");
    let residents = splitNames(tenantRaw);
    for (const c of nameCands.slice(1)) {
      const other = splitNames(String(c.value));
      const same = other.every((o) => residents.some((r) => nameSimilarity(o, r) >= 0.85));
      if (!same) {
        newConflicts.push({
          id: `${propertyId}|${unitNumber}|resident`, propertyId, unitNumber, field: "resident",
          candidates: nameCands.map((n) => ({ sourceId: n.file.id, sourceName: n.file.name, stagedRowId: n.row.id, value: String(n.value), display: String(n.value) })),
          workingValue: residents.join(", "), status: "open", resolvedValue: null,
        });
      }
    }
    if (leaseDoc && val(leaseDoc, "residents")) {
      // a lease spells names out in full — prefer the fuller spelling when it is the same person
      const full = String(val(leaseDoc, "residents")).split(/;\s*/);
      residents = residents.map((r) => full.find((x) => nameSimilarity(x, r) >= 0.85 && x.length > r.length) ?? r);
    }
    prov.push({ propertyId, entity: "lease", entityId: leaseId, field: "residents", sourceId: main.sourceFileId, stagedRowId: main.id, confidence: 1, verified: nameCands.length > 1 });

    const rent = Number(pick("lease", "rent", "rent") ?? 0);
    const start = pick<string>("lease", "leaseStart", "start") ?? pick<string>("lease", "moveIn") ?? asOf;
    const end = pick<string>("lease", "leaseEnd", "end");
    const mtmFlag = billing.some((r) => val(r, "mtm") === true);
    const mtm = mtmFlag || (end != null && end < asOf);

    const recurring: Lease["recurring"] = [];
    for (const type of ["pet", "parking", "storage", "utilities"] as RecurringType[]) {
      const amt = pick<number>("lease", type);
      if (amt) recurring.push({ type, amount: amt, billed: true });
    }
    // In the lease but not on the billing rent roll
    for (const [type, leaseField] of [["pet", "petFee"], ["parking", "parkingFee"]] as [RecurringType, string][]) {
      const amt = val<number>(leaseDoc, leaseField);
      if (amt && !recurring.some((r) => r.type === type)) {
        recurring.push({ type, amount: amt, billed: false });
        prov.push({ propertyId, entity: "lease", entityId: leaseId, field: `${type} (lease, not billed)`, sourceId: leaseDoc!.sourceFileId, stagedRowId: leaseDoc!.id, confidence: f(leaseDoc, leaseField)!.confidence, verified: false });
      }
    }
    const concessions: Lease["concessions"] = [];
    const concAmt = pick<number>("lease", "concession", "concessionAmount");
    const concEnd = pick<string>("lease", "concessionEnds", "concessionEnds");
    if (concAmt && concEnd) concessions.push({ label: "Rent discount", monthlyAmount: concAmt, endsOn: concEnd });

    const hap = pick<number>("lease", "subsidy");
    const leaseTenant = val<number>(leaseDoc, "tenantPortion");
    const leaseHap = val<number>(leaseDoc, "hapPortion");
    const subsidy = hap ? { tenantPortion: rent - hap, hapPortion: hap, leaseTenantPortion: leaseTenant, leaseHapPortion: leaseHap } : null;

    const depositHeld = Number(pick("lease", "deposit") ?? 0);
    const depositRequired = val<number>(leaseDoc, "deposit");
    if (leaseDoc && depositRequired != null) {
      prov.push({ propertyId, entity: "lease", entityId: leaseId, field: "depositRequired", sourceId: leaseDoc.sourceFileId, stagedRowId: leaseDoc.id, confidence: f(leaseDoc, "deposit")!.confidence, verified: false });
    }
    const notes = billing.map((r) => val<string>(r, "notes")).filter(Boolean).join(" · ");
    const lease: Lease & { unitNumber: string } = {
      id: leaseId, unitId, unitNumber, residents, start, end, mtm, contractRent: rent, recurring, concessions, depositHeld, depositRequired,
      subsidy, lateFeeAuthorized: leaseDoc ? val(leaseDoc, "lateFeeAmount") != null : null, mtmPremium: val<number>(leaseDoc, "mtmPremium"),
    };
    domainLeases.push(lease);
    newLeases.push({
      id: leaseId, propertyId, unitId, residents, start, end, mtm, contractRent: rent, recurring, concessions, depositHeld, depositRequired,
      subsidy, lateFeeAuthorized: lease.lateFeeAuthorized, mtmPremium: lease.mtmPremium, notes,
      sourceId: main.sourceFileId, confidence: Math.min(...billing.flatMap((r) => Object.values(r.data).map((c) => c.confidence))),
    });
  }

  const leaseByUnit = new Map(domainLeases.map((l) => [l.unitNumber, l]));

  // ---------- charges: posted from lease terms for every month the ledger covers ----------
  const asOfPeriod = periodOf(asOf);
  let ledgerStart = asOfPeriod;
  for (const r of staged) {
    if (r.kind === "payment" || r.kind === "ledger") {
      const d = val<string>(r, "date");
      if (d && periodOf(d) < ledgerStart) ledgerStart = periodOf(d);
    }
  }
  const domainCharges: Charge[] = [];
  const chargeRows: (typeof chargesT.$inferInsert)[] = [];
  for (const l of domainLeases) {
    for (const p of periodsBetween(ledgerStart, asOfPeriod)) {
      for (const c of chargesForMonth(l, p)) {
        domainCharges.push(c);
        chargeRows.push({ ...c, propertyId, sourceId: null, confidence: 1 });
      }
    }
  }
  for (const r of staged.filter((x) => x.kind === "late_fee")) {
    const l = leaseByUnit.get(String(val(r, "unit")).toUpperCase());
    const date = val<string>(r, "date");
    const amount = val<number>(r, "amount");
    if (!l || !date || !amount) continue;
    const c: Charge = { id: `${l.id}:${periodOf(date)}:late_fee`, leaseId: l.id, type: "late_fee", amount, dueDate: date, period: periodOf(date), payer: "tenant" };
    domainCharges.push(c);
    chargeRows.push({ ...c, propertyId, sourceId: r.sourceFileId, confidence: 1 });
  }

  // ---------- payments ----------
  const payRows: (typeof paymentsT.$inferInsert)[] = [];
  let corroborated = 0;
  const addPayment = (p: typeof paymentsT.$inferInsert): void => {
    // The same payment recorded in two places (e.g. the tracker and the receipt book) is one payment.
    const twin = p.leaseId && payRows.find((x) =>
      x.leaseId === p.leaseId && x.amount === p.amount && x.payerType === p.payerType &&
      Math.abs(daysBetween(x.date, p.date)) <= 2 && x.sourceId !== p.sourceId);
    if (twin) {
      twin.corroboratedBy = [...(twin.corroboratedBy ?? []), p.stagedRowId!];
      corroborated++;
      return;
    }
    payRows.push(p);
  };
  for (const r of staged.filter((x) => x.kind === "payment")) {
    const l = leaseByUnit.get(String(val(r, "unit")).toUpperCase());
    const amount = val<number>(r, "amount");
    const date = val<string>(r, "date");
    if (!amount || !date) continue;
    const note = String(val(r, "note") ?? "");
    const subsidyPay = /hap|housing|voucher|section 8/i.test(note);
    addPayment({
      id: `pay:${r.id}`, propertyId, leaseId: l?.id ?? null, amount, date, payer: l?.residents[0] ?? "", memo: note,
      method: String(val(r, "method") ?? ""), payerType: subsidyPay ? "subsidy" : "tenant",
      matchReason: l ? `Logged against unit ${l.unitNumber} in your payment log` : "Unit in the log isn't on the rent roll",
      corroboratedBy: [], stagedRowId: r.id, sourceId: r.sourceFileId, confidence: 1,
    });
  }
  for (const r of staged.filter((x) => x.kind === "ledger")) {
    const l = leaseByUnit.get(String(val(r, "unit") ?? "").toUpperCase());
    const amount = val<number>(r, "amount");
    const date = val<string>(r, "date");
    if (!amount || !date) continue;
    const conf = Math.min(...["date", "unit", "amount"].map((k) => r.data[k]?.confidence ?? 0));
    addPayment({
      id: `pay:${r.id}`, propertyId, leaseId: l?.id ?? null, amount, date, payer: String(val(r, "name") ?? ""), memo: String(val(r, "note") ?? ""),
      method: /money order/i.test(String(val(r, "note") ?? "")) ? "Money order" : "Cash", payerType: "tenant",
      matchReason: l ? `Unit ${l.unitNumber} written in your receipt book` : "Unit in the receipt book isn't on the rent roll",
      corroboratedBy: [], stagedRowId: r.id, sourceId: r.sourceFileId, confidence: ownerOk(r) ? 1 : conf,
    });
  }
  // bank / payment-app deposits need matching
  const bankRows = staged.filter((x) => x.kind === "bank_txn");
  const paidSoFar = new Map<string, number>();
  for (const p of payRows) if (p.leaseId && p.payerType === "tenant") paidSoFar.set(p.leaseId, (paidSoFar.get(p.leaseId) ?? 0) + p.amount);
  const targets: LeaseTarget[] = domainLeases.map((l) => {
    const month = chargesForMonth(l, asOfPeriod);
    const billed = domainCharges.filter((c) => c.leaseId === l.id && c.payer === "tenant").reduce((t, c) => t + c.amount, 0);
    return {
      leaseId: l.id, unitNumber: l.unitNumber, residents: l.residents,
      expectedTenant: month.filter((c) => c.payer === "tenant").reduce((t, c) => t + c.amount, 0),
      expectedSubsidy: l.subsidy?.hapPortion ?? null,
      openBalance: Math.max(0, billed - (paidSoFar.get(l.id) ?? 0)),
    };
  });
  const deposits: DepositInput[] = bankRows.map((r) => ({
    id: r.id, date: String(val(r, "date")), amount: Number(val(r, "amount")), payer: String(val(r, "payer") ?? ""),
    memo: String(val(r, "memo") ?? ""), description: String(val(r, "description") ?? ""),
  }));
  const matches = matchDeposits(deposits, targets);
  bankRows.forEach((r, i) => {
    const m = matches[i];
    const d = deposits[i];
    addPayment({
      id: `pay:${r.id}`, propertyId, leaseId: m.leaseId, amount: d.amount, date: d.date, payer: d.payer, memo: d.memo,
      method: String(val(r, "method") ?? "Deposit"), payerType: m.payerType,
      matchReason: m.leaseId ? `Matched because ${m.reasons.join(" and ")}${m.partial ? " (partial payment)" : ""}` : m.unmatchedReason ?? "",
      corroboratedBy: [], stagedRowId: r.id, sourceId: r.sourceFileId, confidence: m.confidence,
    });
  });

  // ---------- write everything in one transaction ----------
  db.transaction((tx) => {
    for (const t of [unitsT, leasesT, chargesT, paymentsT, conflictsT, fieldProvenance]) {
      tx.delete(t).where(eq(t.propertyId, propertyId)).run();
    }
    const chunked = <T,>(xs: T[], fn: (c: T[]) => void) => {
      for (let i = 0; i < xs.length; i += 100) fn(xs.slice(i, i + 100));
    };
    chunked(newUnits, (c) => tx.insert(unitsT).values(c).run());
    chunked(newLeases, (c) => tx.insert(leasesT).values(c).run());
    chunked(chargeRows, (c) => tx.insert(chargesT).values(c).run());
    chunked(payRows, (c) => tx.insert(paymentsT).values(c).run());
    chunked(newConflicts, (c) => tx.insert(conflictsT).values(c).run());
    chunked(prov, (c) => tx.insert(fieldProvenance).values(c).run());

    // property header: fill in from the rent roll's title lines when still blank
    const title = files.map((x) => x.meta.title as string | undefined).find(Boolean);
    const patch: Partial<typeof properties.$inferInsert> = { asOf, unitCount: newUnits.length };
    if (title && !property.address) {
      const m = title.match(/^(.+?)\s+-\s+(.+?),\s*([^,]+),\s*([A-Z]{2})\b/);
      if (m) Object.assign(patch, { name: m[1], address: m[2], city: m[3], state: m[4] });
    }
    tx.update(properties).set(patch).where(eq(properties.id, propertyId)).run();
  });

  return {
    propertyId, asOf, units: newUnits.length, leases: newLeases.length, payments: payRows.length,
    unmatchedDeposits: payRows.filter((p) => !p.leaseId).length, conflicts: newConflicts.filter((c) => c.status === "open").length, corroborated,
  };
}

export { addDays, firstOfPeriod };
