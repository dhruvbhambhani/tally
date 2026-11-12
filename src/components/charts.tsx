"use client";

import { Bar, BarChart, Cell, LabelList, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const INK = "#111111";
const ACCENT = "#0F766E";
const GRAY = "#D1D5DB";
const RED = "#DC2626";

const usd = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;

export interface WaterfallBar { key: string; label: string; base: number; value: number; signed: number }

/** The hero visual: from possible rent down to what was collected. */
export function WaterfallChart({ bars }: { bars: WaterfallBar[] }) {
  const color = (k: string) => (k === "gpr" ? INK : k === "collected" ? ACCENT : k === "unpaid" ? RED : GRAY);
  return (
    <div className="overflow-x-auto"><div className="h-[340px] w-full min-w-[640px]" role="img" aria-label={`Waterfall: ${bars.map((b) => `${b.label} ${usd(b.signed)}`).join(", ")}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={bars} margin={{ top: 28, right: 8, left: 8, bottom: 0 }} barCategoryGap="22%">
          <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "#6B7280", fontSize: 13 }} interval={0} />
          <YAxis hide domain={[0, "dataMax"]} />
          <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} />
          <Bar dataKey="value" stackId="w" radius={[4, 4, 4, 4]} isAnimationActive={false}>
            {bars.map((b) => <Cell key={b.key} fill={color(b.key)} />)}
            <LabelList dataKey="signed" position="top" formatter={(v) => { const n = Number(v); return n < 0 ? `−${usd(-n)}` : usd(n); }}
              style={{ fill: INK, fontSize: 14, fontWeight: 600, fontVariantNumeric: "tabular-nums" }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div></div>
  );
}

export function TrendChart({ points }: { points: { label: string; rate: number }[] }) {
  return (
    <div className="h-[56px] w-[140px]" role="img" aria-label={`Collection rate by month: ${points.map((p) => `${p.label} ${p.rate.toFixed(1)}%`).join(", ")}`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 6, right: 6, left: 6, bottom: 6 }}>
          <YAxis hide domain={["dataMin - 2", "dataMax + 2"]} />
          <Tooltip cursor={false} formatter={(v) => [`${Number(v).toFixed(1)}%`, "Paid"]} labelFormatter={(_, p) => p?.[0]?.payload?.label ?? ""}
            contentStyle={{ borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 12, padding: "4px 8px" }} />
          <Line type="monotone" dataKey="rate" stroke={ACCENT} strokeWidth={2} dot={{ r: 2, fill: ACCENT }} activeDot={{ r: 4 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ExpirationsChart({ months }: { months: { label: string; count: number; flagged: boolean }[] }) {
  return (
    <div className="overflow-x-auto"><div className="h-[260px] w-full min-w-[640px]" role="img" aria-label={`Leases ending by month: ${months.map((m) => `${m.label} ${m.count}`).join(", ")}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={months} margin={{ top: 24, right: 0, left: 0, bottom: 0 }} barCategoryGap="28%">
          <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "#6B7280", fontSize: 12 }} interval={0} />
          <YAxis hide />
          <Bar dataKey="count" radius={[4, 4, 0, 0]} isAnimationActive={false}>
            {months.map((m) => <Cell key={m.label} fill={m.flagged ? INK : GRAY} />)}
            <LabelList dataKey="count" position="top" style={{ fill: INK, fontSize: 13, fontWeight: 600 }} formatter={(v) => (Number(v) ? String(v) : "")} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div></div>
  );
}
