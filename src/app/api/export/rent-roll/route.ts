import * as XLSX from "xlsx";
import { getContext } from "@/lib/context";
import { RENT_ROLL_COLUMNS, rentRollCells, rentRollPdf } from "@/lib/pdf/documents";

export const dynamic = "force-dynamic";

/** Rent roll export: /api/export/rent-roll?format=csv|xlsx|pdf&units=101,102 */
export async function GET(req: Request) {
  const ctx = await getContext();
  if (!ctx) return new Response("No rent roll yet", { status: 404 });
  const url = new URL(req.url);
  const format = url.searchParams.get("format") ?? "csv";
  const only = (url.searchParams.get("units") ?? "").split(",").filter(Boolean);
  const rows = ctx.a.rentRoll.filter((r) => !only.length || only.includes(r.unit));
  const name = `${ctx.data.property.name.replace(/\W+/g, "-").toLowerCase()}-rent-roll-${ctx.a.asOf}`;

  if (format === "pdf") {
    const pdf = await rentRollPdf(ctx.data.property.name, ctx.a.asOf, rows);
    return new Response(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}.pdf"` } });
  }
  // Spreadsheet exports carry real numbers (dollars), not formatted text, so they can be summed.
  const dollars = (c: number | null) => (c == null ? "" : c / 100);
  const table = [
    RENT_ROLL_COLUMNS.map((c) => c.label),
    ...rows.map((r) => {
      const t = rentRollCells(r);
      return [r.unit, r.unitType, r.sqft, r.status, r.resident, r.leaseStart ?? "", r.mtm ? "Month-to-month" : r.leaseEnd ?? "", dollars(r.marketRent), dollars(r.contractRent),
        r.leaseId ? dollars(r.otherCharges) : "", r.leaseId ? dollars(r.concessions) : "", dollars(r.deposit), r.leaseId ? dollars(r.balance) : "", t.lastPayment === "—" ? "" : r.lastPayment!.date];
    }),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(table);
  if (format === "xlsx") {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, "Rent roll");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    return new Response(new Uint8Array(buf), {
      headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${name}.xlsx"` },
    });
  }
  return new Response(XLSX.utils.sheet_to_csv(sheet), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.csv"` } });
}
