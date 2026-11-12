"use client";

import { useMemo, useState } from "react";
import { Download, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface RentRollViewRow {
  unit: string; unitType: string; sqft: number; status: string; resident: string; leaseStart: string; leaseEnd: string;
  marketRent: string; contractRent: string; otherCharges: string; concessions: string; deposit: string; balance: string; lastPayment: string;
  owes: boolean; belowMarket: boolean; flag: string;
}

const STATUS_LABEL: Record<string, string> = { occupied: "Occupied", vacant: "Vacant", notice: "Moving out", down: "Offline", model: "Model", employee: "Staff" };

export function RentRollTable({ rows, initialUnits, initialStatus }: { rows: RentRollViewRow[]; initialUnits: string[]; initialStatus: string }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState(initialStatus);
  const [units, setUnits] = useState(initialUnits);
  const [onlyOwing, setOnlyOwing] = useState(false);

  const shown = useMemo(() => rows.filter((r) =>
    (!units.length || units.includes(r.unit)) &&
    (!status || r.status === status) &&
    (!onlyOwing || r.owes) &&
    (!q || `${r.unit} ${r.resident} ${r.unitType}`.toLowerCase().includes(q.toLowerCase()))), [rows, units, status, onlyOwing, q]);

  const exportHref = (format: string) => `/api/export/rent-roll?format=${format}&units=${encodeURIComponent(shown.length === rows.length ? "" : shown.map((r) => r.unit).join(","))}`;
  const th = "sticky top-0 whitespace-nowrap bg-white px-2.5 py-3 text-left text-[12px] font-medium text-muted";
  const td = "whitespace-nowrap px-2.5 py-3 text-[13px]";

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search unit or name" aria-label="Search unit or name"
            className="h-10 w-[240px] rounded-lg border border-line pl-9 pr-3 text-sm" />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status" className="h-10 rounded-lg border border-line bg-white px-3 text-sm">
          <option value="">All units</option>
          {Object.entries(STATUS_LABEL).filter(([k]) => rows.some((r) => r.status === k)).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={onlyOwing} onChange={(e) => setOnlyOwing(e.target.checked)} className="size-4 accent-[#0F766E]" /> Owes money
        </label>
        {units.length ? (
          <button type="button" onClick={() => setUnits([])} className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-wash px-3 py-1.5 text-[13px]">
            Showing {units.length} selected {units.length === 1 ? "unit" : "units"} <X className="size-3.5" />
          </button>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <span className="num text-[13px] text-muted">{shown.length} of {rows.length}</span>
          {["xlsx", "csv", "pdf"].map((f) => (
            <Button key={f} asChild size="sm"><a href={exportHref(f)} download><Download /> {f === "xlsx" ? "Excel" : f.toUpperCase()}</a></Button>
          ))}
        </div>
      </div>

      <div className="mt-5 max-h-[720px] overflow-auto rounded-xl border border-line">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-line">
              {["Unit", "Type", "Sq ft", "Status", "Resident", "Lease start", "Lease end", "Market rent", "Rent", "Other charges", "Discount", "Deposit", "Balance", "Last paid"].map((h, i) => (
                <th key={h} scope="col" className={cn(th, i >= 7 && i <= 12 && "text-right", i === 2 && "text-right")}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.unit} className="border-b border-line last:border-0 hover:bg-wash">
                <td className={cn(td, "font-medium")}>{r.unit}</td>
                <td className={cn(td, "text-muted")}>{r.unitType}</td>
                <td className={cn(td, "num text-right text-muted")}>{r.sqft}</td>
                <td className={td}>{STATUS_LABEL[r.status] ?? r.status}</td>
                <td className={td}>
                  {r.resident || <span className="text-muted">—</span>}
                  {r.flag ? <span className="ml-2 rounded-full bg-wash px-2 py-0.5 text-[11px] text-muted">{r.flag}</span> : null}
                </td>
                <td className={cn(td, "text-muted")}>{r.leaseStart}</td>
                <td className={td}>{r.leaseEnd}</td>
                <td className={cn(td, "num text-right text-muted")}>{r.marketRent}</td>
                <td className={cn(td, "num text-right font-medium")}>{r.contractRent}</td>
                <td className={cn(td, "num text-right text-muted")}>{r.otherCharges}</td>
                <td className={cn(td, "num text-right text-muted")}>{r.concessions}</td>
                <td className={cn(td, "num text-right text-muted")}>{r.deposit}</td>
                <td className={cn(td, "num text-right", r.owes ? "font-semibold text-danger" : "text-muted")}>{r.balance}</td>
                <td className={cn(td, "text-muted")}>{r.lastPayment}</td>
              </tr>
            ))}
            {!shown.length ? <tr><td colSpan={14} className="px-3 py-10 text-center text-sm text-muted">No units match.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
