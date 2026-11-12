import { redirect } from "next/navigation";
import { Hint } from "@/components/ui/hint";
import { getContext } from "@/lib/context";
import { listNotices, listPromises } from "@/lib/data/load";
import { formatDate } from "@/lib/dates";
import { FRIENDLY_LABELS, suggestedStep } from "@/lib/delinquency/letters";
import { availableNotices } from "@/lib/delinquency/notices";
import { AGING_BUCKETS } from "@/lib/metrics/ledger";
import { money } from "@/lib/money";
import { DelinquencyList, type DelinquentRow } from "./parts";

export const dynamic = "force-dynamic";

const BUCKET_LABEL: Record<string, string> = { current: "Not yet late", "1-30": "1–30 days", "31-60": "31–60 days", "61-90": "61–90 days", "90+": "Over 90 days" };
const BUCKET_COLOR: Record<string, string> = { current: "#E5E7EB", "1-30": "#FCA5A5", "31-60": "#F87171", "61-90": "#DC2626", "90+": "#991B1B" };

export default async function DelinquencyPage() {
  const ctx = await getContext();
  if (!ctx) redirect("/");
  const { data, a, db } = ctx;
  const notices = listNotices(db, data.property.id);
  const promises = listPromises(db, data.property.id);
  const formal = availableNotices(data.property.state);
  const typeLabel = (t: string) => FRIENDLY_LABELS[t as keyof typeof FRIENDLY_LABELS] ?? formal.find((f) => f.type === t)?.title ?? t;
  const periods = a.trend.map((t) => t.period);

  const rows: DelinquentRow[] = a.aging.byLease.map((la) => {
    const lease = data.leaseById.get(la.leaseId)!;
    const unit = data.unitNumberOf(la.leaseId);
    const step = suggestedStep(la.daysLate, data.settings.ladder);
    const last = notices.find((n) => n.unitNumber === unit);
    const promise = promises.filter((p) => p.unitNumber === unit).sort((x, y) => y.createdAt.localeCompare(x.createdAt))[0];
    const history = periods.map((p) => {
      const s = a.alloc.states.find((x) => x.charge.leaseId === la.leaseId && x.charge.period === p && x.charge.type === "rent" && x.charge.payer === "tenant");
      const grace = `${p}-${String(data.policy.graceDay).padStart(2, "0")}`;
      const state = !s ? "none" : s.open > 0 ? (s.paid > 0 ? "partial" : "unpaid") : s.paidOn && s.paidOn > grace ? "late" : "ontime";
      return { label: formatDate(p, "month"), state: state as "none" | "ontime" | "late" | "partial" | "unpaid" };
    });
    return {
      leaseId: la.leaseId, unit, resident: lease.residents.join(" & "), balance: money(la.balance), bucket: BUCKET_LABEL[la.oldestBucket],
      daysLate: la.daysLate, history,
      promise: promise ? `${money(promise.amount)} by ${formatDate(promise.promisedFor)}` : "",
      subsidy: lease.subsidy ? `Voucher pays ${money(lease.subsidy.hapPortion)} of ${money(lease.contractRent)}` : "",
      lastContact: last ? `${typeLabel(last.type)} · ${last.status === "sent" ? `sent ${formatDate((last.sentAt ?? "").slice(0, 10))}` : `approved ${formatDate((last.approvedAt ?? "").slice(0, 10))}, not sent`}` : "",
      step: step ? { key: step.key, label: step.label, requiresApproval: step.requiresApproval } : null,
      note: data.leaseRows.get(la.leaseId)?.notes ?? "",
    };
  });

  const total = a.aging.total;
  return (
    <div className="mx-auto max-w-[1440px] px-6 py-14 lg:px-10">
      <p className="text-sm text-muted">Who owes · {data.property.name}</p>
      <h1 className="rise mt-2 text-3xl font-medium tracking-tight text-muted sm:text-4xl">
        <span className="num block text-6xl font-semibold text-danger sm:text-7xl">{money(total)}</span>
        owed by {rows.length} {rows.length === 1 ? "resident" : "residents"}
      </h1>

      <section className="mt-10" aria-label="How old the debt is">
        <p className="flex items-center gap-1.5 text-[13px] text-muted">
          How old the debt is
          <Hint>Aging: each unpaid charge is grouped by how many days past due it is. Older debt is much harder to collect, so one total hides what matters.</Hint>
        </p>
        {total > 0 ? (
          <div className="mt-3 flex h-3 w-full overflow-hidden rounded-full bg-wash" role="img"
            aria-label={AGING_BUCKETS.map((b) => `${BUCKET_LABEL[b]}: ${money(a.aging.totals[b])}`).join(", ")}>
            {AGING_BUCKETS.filter((b) => a.aging.totals[b] > 0).map((b) => (
              <div key={b} style={{ width: `${(a.aging.totals[b] / total) * 100}%`, background: BUCKET_COLOR[b] }} className="border-r-2 border-white last:border-0" />
            ))}
          </div>
        ) : null}
        <dl className="mt-4 grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-5">
          {AGING_BUCKETS.map((b) => (
            <div key={b}>
              <dt className="flex items-center gap-2 text-[13px] text-muted"><span className="size-2 rounded-full" style={{ background: BUCKET_COLOR[b] }} />{BUCKET_LABEL[b]}</dt>
              <dd className="num mt-1 text-2xl font-semibold tracking-tight">{money(a.aging.totals[b])}</dd>
            </div>
          ))}
        </dl>
      </section>

      {rows.length ? (
        <DelinquencyList rows={rows} propertyName={data.property.name}
          formal={formal.map((f) => ({ type: f.type, title: f.title }))} ladder={data.settings.ladder.map((s) => s.label)} />
      ) : <p className="mt-12 text-muted">Nobody owes you money right now.</p>}

      <section className="mt-16">
        <h2 className="flex items-center gap-1.5 text-lg font-semibold">
          Letter log
          <Hint>Every letter you approved, and how and when you delivered it. Tally never sends anything on its own.</Hint>
        </h2>
        {notices.length ? (
          <table className="mt-4 w-full text-sm">
            <thead><tr className="border-b border-line text-left text-[12px] text-muted">
              {["Resident", "Letter", "Amount", "Approved", "By", "Delivered"].map((h) => <th key={h} className="px-3 py-2 font-medium first:pl-0">{h}</th>)}
            </tr></thead>
            <tbody>
              {notices.map((n) => (
                <tr key={n.id} className="border-b border-line">
                  <td className="py-3 pr-3">{n.resident} <span className="text-muted">· Unit {n.unitNumber}</span></td>
                  <td className="px-3 py-3">{typeLabel(n.type)}{n.language === "es" ? " (Spanish)" : ""}</td>
                  <td className="num px-3 py-3">{money(n.amount)}</td>
                  <td className="px-3 py-3 text-muted">{formatDate((n.approvedAt ?? "").slice(0, 10))}</td>
                  <td className="px-3 py-3 text-muted">{n.approvedBy}</td>
                  <td className="px-3 py-3">{n.status === "sent" ? `${n.method}, ${formatDate((n.sentAt ?? "").slice(0, 10))}` : <span className="text-muted">Not yet</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="mt-3 text-sm text-muted">No letters yet. Approved letters will be listed here with who approved them and how they went out.</p>}
      </section>
    </div>
  );
}
