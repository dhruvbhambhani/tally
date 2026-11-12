/** PDF output (letters, notices, rent roll) with @react-pdf/renderer. No JSX so it runs anywhere. */
import { createElement as h } from "react";
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { RentRollRow } from "../analysis";
import { formatDate } from "../dates";
import { money } from "../money";

const s = StyleSheet.create({
  page: { paddingVertical: 60, paddingHorizontal: 64, fontSize: 11, fontFamily: "Helvetica", lineHeight: 1.5, color: "#111111" },
  mono: { fontFamily: "Courier", fontSize: 10 },
  footer: { position: "absolute", bottom: 28, left: 64, right: 64, fontSize: 8, color: "#6B7280", textAlign: "center" },
  h1: { fontSize: 16, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  sub: { fontSize: 9, color: "#6B7280", marginBottom: 14 },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#E5E7EB", paddingVertical: 3 },
  th: { fontFamily: "Helvetica-Bold", fontSize: 7.5, color: "#6B7280" },
  td: { fontSize: 7.5 },
});

/** A letter or notice. Lines that look like an itemized table are set in a fixed-width font so columns line up. */
export async function letterPdf(body: string, opts: { footer?: string } = {}): Promise<Buffer> {
  const blocks = body.split("\n").map((line, i) =>
    h(Text, { key: i, style: /^\s{2}\S/.test(line) && /\$[\d,]+\.\d{2}\s*$/.test(line) && !line.includes("•") ? s.mono : undefined, minPresenceAhead: 12 }, line || " "),
  );
  return renderToBuffer(
    h(Document, null,
      h(Page, { size: "LETTER", style: s.page },
        ...blocks,
        h(Text, { style: s.footer, fixed: true }, opts.footer ?? "Prepared with Tally. Not legal or financial advice."),
      ),
    ),
  );
}

const COLS: { key: string; label: string; w: number; right?: boolean }[] = [
  { key: "unit", label: "Unit", w: 5 }, { key: "unitType", label: "Type", w: 8 }, { key: "sqft", label: "Sq ft", w: 5, right: true },
  { key: "status", label: "Status", w: 7 }, { key: "resident", label: "Resident", w: 17 }, { key: "leaseStart", label: "Start", w: 8 },
  { key: "leaseEnd", label: "End", w: 8 }, { key: "marketRent", label: "Market", w: 7, right: true }, { key: "contractRent", label: "Rent", w: 7, right: true },
  { key: "otherCharges", label: "Other", w: 6, right: true }, { key: "concessions", label: "Discount", w: 6, right: true },
  { key: "deposit", label: "Deposit", w: 7, right: true }, { key: "balance", label: "Balance", w: 7, right: true }, { key: "lastPayment", label: "Last paid", w: 8 },
];

export function rentRollCells(r: RentRollRow): Record<string, string> {
  return {
    unit: r.unit, unitType: r.unitType, sqft: String(r.sqft), status: r.status, resident: r.resident || "—",
    leaseStart: r.leaseStart ? formatDate(r.leaseStart) : "—", leaseEnd: r.mtm ? "Month-to-month" : r.leaseEnd ? formatDate(r.leaseEnd) : "—",
    marketRent: money(r.marketRent), contractRent: money(r.contractRent), otherCharges: r.leaseId ? money(r.otherCharges) : "—",
    concessions: r.leaseId ? money(r.concessions) : "—", deposit: money(r.deposit), balance: r.leaseId ? money(r.balance) : "—",
    lastPayment: r.lastPayment ? formatDate(r.lastPayment.date) : "—",
  };
}

export async function rentRollPdf(propertyName: string, asOf: string, rows: RentRollRow[]): Promise<Buffer> {
  const cell = (c: (typeof COLS)[number], text: string, head: boolean) =>
    h(Text, { key: c.key, style: [head ? s.th : s.td, { width: `${c.w}%`, textAlign: c.right ? "right" : "left", paddingRight: 4 }] }, text);
  return renderToBuffer(
    h(Document, null,
      h(Page, { size: "LETTER", orientation: "landscape", style: { ...s.page, paddingHorizontal: 32, paddingVertical: 36 } },
        h(Text, { style: s.h1 }, `${propertyName} — Rent roll`),
        h(Text, { style: s.sub }, `As of ${formatDate(asOf, "long")} · ${rows.length} units`),
        h(View, { style: s.row, fixed: true }, ...COLS.map((c) => cell(c, c.label, true))),
        ...rows.map((r) => {
          const cells = rentRollCells(r);
          return h(View, { key: r.unitId, style: s.row, wrap: false }, ...COLS.map((c) => cell(c, cells[c.key], false)));
        }),
        h(Text, { style: { ...s.footer, left: 32, right: 32 }, fixed: true }, "Prepared with Tally. Not legal or financial advice."),
      ),
    ),
  );
}

export const RENT_ROLL_COLUMNS = COLS.map((c) => ({ key: c.key, label: c.label }));
