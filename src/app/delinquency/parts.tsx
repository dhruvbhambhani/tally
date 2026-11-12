"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Check, Copy, FileDown, Loader2, ShieldAlert } from "lucide-react";
import { addPromise, approveLetter, draftLetter, markSent, type Draft } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export interface DelinquentRow {
  leaseId: string; unit: string; resident: string; balance: string; bucket: string; daysLate: number;
  history: { label: string; state: "none" | "ontime" | "late" | "partial" | "unpaid" }[];
  promise: string; subsidy: string; lastContact: string; note: string;
  step: { key: string; label: string; requiresApproval: boolean } | null;
}

const HISTORY: Record<string, { h: number; color: string; text: string }> = {
  none: { h: 3, color: "#E5E7EB", text: "no charge" }, ontime: { h: 20, color: "#D1D5DB", text: "paid on time" },
  late: { h: 20, color: "#6B7280", text: "paid late" }, partial: { h: 11, color: "#F87171", text: "partly paid" }, unpaid: { h: 4, color: "#DC2626", text: "unpaid" },
};

function Sparkline({ history }: { history: DelinquentRow["history"] }) {
  return (
    <span className="inline-flex h-5 items-end gap-[3px]" role="img" aria-label={`Payment history: ${history.map((h) => `${h.label} ${HISTORY[h.state].text}`).join(", ")}`}>
      {history.map((h) => <span key={h.label} title={`${h.label}: ${HISTORY[h.state].text}`} className="w-[7px] rounded-[2px]" style={{ height: HISTORY[h.state].h, background: HISTORY[h.state].color }} />)}
    </span>
  );
}

const STEP_TO_TYPE: Record<string, string> = { friendly_reminder: "friendly_reminder", second_reminder: "second_reminder", payment_plan: "payment_plan" };

export function DelinquencyList({ rows, formal, ladder, propertyName }: {
  rows: DelinquentRow[]; formal: { type: string; title: string }[]; ladder: string[]; propertyName: string;
}) {
  const [active, setActive] = useState<DelinquentRow | null>(null);
  const next = rows.find((r) => !r.lastContact) ?? rows[0];
  return (
    <section className="mt-14">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h2 className="flex items-center gap-1.5 text-lg font-semibold">
          Residents with a balance
          <Hint>The suggested step follows your ladder: {ladder.join(" → ")}. Change the timing in Settings. Formal notices always need your approval.</Hint>
        </h2>
        <Button variant="primary" size="lg" onClick={() => setActive(next)}>Draft next letter</Button>
      </div>
      <div className="mt-5 overflow-x-auto rounded-xl border border-line">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left text-[12px] text-muted">
              {["Resident", "Owes", "Oldest debt", "Last 6 months", "Promise to pay", "Last contact", "Suggested next step"].map((h, i) => (
                <th key={h} scope="col" className={cn("whitespace-nowrap px-4 py-3 font-medium", i === 1 && "text-right")}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.leaseId} className="border-b border-line align-top last:border-0">
                <td className="px-4 py-4">
                  <p className="font-medium">{r.resident}</p>
                  <p className="text-[13px] text-muted">Unit {r.unit}{r.subsidy ? ` · ${r.subsidy}` : ""}</p>
                  {r.note ? <p className="mt-1 max-w-[30ch] text-[13px] text-muted">Your note: {r.note}</p> : null}
                </td>
                <td className="num px-4 py-4 text-right text-lg font-semibold text-danger">{r.balance}</td>
                <td className="whitespace-nowrap px-4 py-4">{r.bucket}<p className="num text-[13px] text-muted">{r.daysLate} days late</p></td>
                <td className="px-4 py-4"><Sparkline history={r.history} /></td>
                <td className="px-4 py-4">{r.promise || <span className="text-muted">None logged</span>}</td>
                <td className="px-4 py-4">{r.lastContact || <span className="text-muted">None yet</span>}</td>
                <td className="px-4 py-4">
                  <Button size="sm" onClick={() => setActive(r)}>{r.step?.label ?? "Draft a letter"}</Button>
                  {r.step?.requiresApproval ? <p className="mt-1 text-[12px] text-muted">Needs your approval</p> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {active ? <LetterDrawer key={active.leaseId} row={active} formal={formal} propertyName={propertyName} onClose={() => setActive(null)} /> : null}
    </section>
  );
}

function LetterDrawer({ row, formal, propertyName, onClose }: { row: DelinquentRow; formal: { type: string; title: string }[]; propertyName: string; onClose: () => void }) {
  const router = useRouter();
  const suggested = row.step?.key === "formal_notice" ? formal[0]?.type ?? "second_reminder" : row.step?.key === "attorney" ? "attorney" : STEP_TO_TYPE[row.step?.key ?? ""] ?? "friendly_reminder";
  const [type, setType] = useState(suggested);
  const [language, setLanguage] = useState<"en" | "es">("en");
  const [channel, setChannel] = useState<"letter" | "email" | "sms">("letter");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [approvedId, setApprovedId] = useState<string | null>(null);
  const [sent, setSent] = useState("");
  const [method, setMethod] = useState("Mail");
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, start] = useTransition();
  const isFormal = formal.some((f) => f.type === type);

  useEffect(() => {
    if (type === "attorney") return;
    let cancelled = false;
    draftLetter({ leaseId: row.leaseId, type: type as never, channel, language }).then((d) => {
      if (cancelled) return;
      if ("error" in d) { setError(d.error); setDraft(null); setBody(""); }
      else { setDraft(d); setBody(d.body); setError(""); }
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [type, language, channel, row.leaseId]);

  const change = <T,>(set: (v: T) => void) => (v: T) => { set(v); setLoading(true); setApprovedId(null); setSent(""); };
  const select = "h-10 rounded-lg border border-line bg-white px-3 text-sm";

  const exportPdf = async () => {
    const res = await fetch("/api/letter-pdf", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body, name: `${type}-unit-${row.unit}` }) });
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url; a.download = `${type.replace(/_/g, "-")}-unit-${row.unit}.pdf`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title={`${row.resident} · Unit ${row.unit}`} description={`Owes ${row.balance} · ${row.daysLate} days late · ${propertyName}`}>
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-[13px] text-muted">Letter
          <select className={cn(select, "min-w-[230px] text-ink")} value={type} onChange={(e) => change(setType)(e.target.value)}>
            <optgroup label="Friendly (written from the ledger)">
              <option value="friendly_reminder">Friendly reminder</option>
              <option value="second_reminder">Second reminder</option>
              <option value="payment_plan">Payment-plan offer</option>
              <option value="payment_receipt">Payment receipt</option>
            </optgroup>
            <optgroup label="Formal (from attorney-reviewable templates)">
              {formal.map((f) => <option key={f.type} value={f.type}>{f.title}</option>)}
              <option value="attorney">Refer to attorney</option>
            </optgroup>
          </select>
        </label>
        {!isFormal && type !== "attorney" ? (
          <>
            <label className="flex flex-col gap-1 text-[13px] text-muted">Language
              <select className={cn(select, "text-ink")} value={language} onChange={(e) => change(setLanguage)(e.target.value as "en" | "es")}>
                <option value="en">English</option><option value="es">Spanish</option>
              </select>
            </label>
            {type !== "payment_receipt" ? (
              <label className="flex flex-col gap-1 text-[13px] text-muted">Format
                <select className={cn(select, "text-ink")} value={channel} onChange={(e) => change(setChannel)(e.target.value as "letter" | "email" | "sms")}>
                  <option value="letter">Letter</option><option value="email">Email</option><option value="sms">Text message</option>
                </select>
              </label>
            ) : null}
          </>
        ) : null}
      </div>

      {type === "attorney" ? (
        <div className="mt-6 rounded-xl bg-wash p-5 text-sm leading-relaxed">
          <p className="font-medium">Time to talk to your attorney.</p>
          <p className="mt-2 text-muted">Tally doesn&apos;t prepare court filings. Export the rent roll row and the letter log for this resident and share them with your attorney, who can advise on next steps under your state and local law.</p>
        </div>
      ) : (
        <>
          {draft?.alerts.map((al) => (
            <div key={al.text} className={cn("mt-5 flex gap-3 rounded-xl p-4 text-sm leading-relaxed", al.tone === "block" ? "bg-danger-soft text-ink" : "bg-wash text-muted")}>
              {al.tone === "block" ? <ShieldAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden /> : null}
              <p>{al.text}</p>
            </div>
          ))}
          {error ? <p className="mt-5 text-sm text-danger" role="alert">{error}</p> : null}
          <label className="mt-6 block text-[13px] text-muted" htmlFor="letter-body">Preview — edit anything before you approve</label>
          <div className="relative mt-2">
            <textarea id="letter-body" value={body} onChange={(e) => { setBody(e.target.value); setApprovedId(null); }} spellCheck
              className={cn("h-[440px] w-full resize-y rounded-xl border border-line p-5 text-[13.5px] leading-relaxed", isFormal && "font-mono text-[12.5px]", loading && "opacity-40")} />
            {loading ? <Loader2 className="absolute left-1/2 top-1/2 size-5 -translate-x-1/2 animate-spin text-muted" /> : null}
          </div>

          {!approvedId ? (
            <div className="mt-5 flex flex-wrap items-center gap-4">
              <Button variant="primary" size="lg" disabled={busy || loading || !body.trim()}
                onClick={() => start(async () => {
                  const r = await approveLetter({ leaseId: row.leaseId, type, language: isFormal ? "en" : language, body, amount: draft?.amount ?? null });
                  if ("error" in r) setError(r.error); else { setApprovedId(r.id); router.refresh(); }
                })}>
                {busy ? <Loader2 className="animate-spin" /> : <Check />} Approve
              </Button>
              <p className="text-[13px] text-muted">Approving doesn&apos;t send anything. You deliver it yourself.</p>
            </div>
          ) : (
            <div className="fade-in mt-5 rounded-xl border border-line p-5">
              <p className="flex items-center gap-2 font-medium"><Check className="size-4 text-accent" /> Approved and logged. Nothing has been sent.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button onClick={exportPdf}><FileDown /> Export PDF</Button>
                <Button onClick={async () => { await navigator.clipboard.writeText(body); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
                  <Copy /> {copied ? "Copied" : "Copy text"}
                </Button>
              </div>
              {sent ? <p className="mt-4 text-sm text-muted">Logged as delivered by {sent.toLowerCase()}.</p> : (
                <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-muted">After you deliver it, log how:</span>
                  <select aria-label="How it was delivered" className={cn(select, "h-8")} value={method} onChange={(e) => setMethod(e.target.value)}>
                    {["Mail", "Email", "Text message", "Hand delivery", "Posted on door"].map((m) => <option key={m}>{m}</option>)}
                  </select>
                  <Button size="sm" disabled={busy} onClick={() => start(async () => { await markSent(approvedId, method); setSent(method); router.refresh(); })}>Mark as delivered</Button>
                </div>
              )}
            </div>
          )}
        </>
      )}

      <PromiseForm unit={row.unit} existing={row.promise} />
    </Sheet>
  );
}

function PromiseForm({ unit, existing }: { unit: string; existing: string }) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, start] = useTransition();
  const input = "h-9 rounded-lg border border-line px-3 text-sm";
  return (
    <details className="group mt-8 border-t border-line pt-6">
      <summary className="cursor-pointer list-none text-sm font-medium underline-offset-4 hover:underline">Log a promise to pay{existing ? ` (latest: ${existing})` : ""}</summary>
      <form className="fade-in mt-4 flex flex-wrap items-end gap-3" onSubmit={(e) => {
        e.preventDefault();
        start(async () => { const r = await addPromise(unit, amount, date, note); setMsg(r.error ?? "Saved."); if (!r.error) { setAmount(""); setDate(""); setNote(""); router.refresh(); } });
      }}>
        <label className="flex flex-col gap-1 text-[13px] text-muted">Amount<input className={cn(input, "w-[110px] text-ink")} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="$" inputMode="decimal" /></label>
        <label className="flex flex-col gap-1 text-[13px] text-muted">By<input type="date" className={cn(input, "text-ink")} value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="flex flex-1 flex-col gap-1 text-[13px] text-muted">Note<input className={cn(input, "min-w-[160px] text-ink")} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <Button type="submit" disabled={busy}>Save</Button>
      </form>
      {msg ? <p className="mt-2 text-sm text-muted" role="status">{msg}</p> : null}
    </details>
  );
}
