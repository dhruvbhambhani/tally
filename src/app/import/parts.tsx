"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { ArrowRight, ChevronDown, Loader2, Upload } from "lucide-react";
import { assignDeposit, buildNow, loadSample, resolveConflict, reviewRow, saveMapping, uploadFiles } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------- drop zone
export function DropZone({ hasFiles, demo }: { hasFiles: boolean; demo: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [progress, setProgress] = useState<{ name: string; state: "reading" | "done" | "problem"; note?: string }[]>([]);
  const [busy, start] = useTransition();

  const send = (files: File[]) => {
    if (!files.length) return;
    setProgress(files.map((f) => ({ name: f.name, state: "reading" })));
    start(async () => {
      // one file at a time so each row can show its own result
      for (const f of files) {
        const fd = new FormData();
        fd.append("files", f);
        try {
          const [res] = await uploadFiles(fd);
          setProgress((p) => p.map((x) => (x.name === f.name ? { name: f.name, state: res?.kind === "unknown" || !res?.rows ? "problem" : "done", note: res?.note ?? (res ? `${res.rows} records` : "") } : x)));
        } catch {
          setProgress((p) => p.map((x) => (x.name === f.name ? { ...x, state: "problem", note: "Couldn't read this file." } : x)));
        }
      }
      router.refresh();
    });
  };

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); send([...e.dataTransfer.files]); }}
        className={cn(
          "flex flex-col items-center justify-center rounded-2xl border border-dashed px-6 text-center transition-colors",
          hasFiles ? "py-8" : "py-16", over ? "border-accent bg-accent-soft" : "border-line bg-wash",
        )}
      >
        <Upload className="size-6 text-muted" aria-hidden />
        <p className="mt-3 font-medium">Drag files here</p>
        <p className="mt-1 text-sm text-muted">CSV, Excel, PDF, or photos</p>
        <input ref={input} type="file" multiple className="sr-only" aria-label="Choose files"
          accept=".csv,.xlsx,.xls,.pdf,.jpg,.jpeg,.png,.webp,.tif,.tiff"
          onChange={(e) => { send([...(e.target.files ?? [])]); e.target.value = ""; }} />
        <div className="mt-5 flex flex-wrap items-center justify-center gap-4">
          <Button variant={hasFiles ? "outline" : "primary"} size={hasFiles ? "md" : "lg"} disabled={busy} onClick={() => input.current?.click()}>
            {busy ? <Loader2 className="animate-spin" /> : null} Choose files
          </Button>
          {!hasFiles ? (
            <button type="button" disabled={busy} className="cursor-pointer text-sm font-medium text-ink underline-offset-4 hover:underline disabled:opacity-50"
              onClick={() => start(async () => { await loadSample(); router.refresh(); })}>
              Try it with sample files
            </button>
          ) : null}
        </div>
      </div>
      {demo ? <p className="mt-3 text-[13px] text-muted">Running without an AI key: spreadsheets, bank statements and plainly worded leases are read directly; new handwriting needs a key.</p> : null}
      {progress.length ? (
        <ul className="mt-4 space-y-1 text-sm" aria-live="polite">
          {progress.map((p) => (
            <li key={p.name} className="flex items-center gap-3">
              {p.state === "reading" ? <Loader2 className="size-3.5 animate-spin text-muted" /> : <span className={cn("size-1.5 rounded-full", p.state === "done" ? "bg-accent" : "bg-muted")} />}
              <span className="font-medium">{p.name}</span>
              <span className="text-muted">{p.state === "reading" ? "Reading…" : p.note}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- column mapping
interface TableView { sheet: string; headers: string[]; mapping: Record<string, string>; remembered: boolean; rows: number; fields: { key: string; label: string }[] }

export function MappingEditor({ fileId, tables }: { fileId: string; tables: TableView[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [maps, setMaps] = useState(() => Object.fromEntries(tables.map((t) => [t.sheet, t.mapping])));
  const [busy, start] = useTransition();
  const mapped = tables.reduce((n, t) => n + Object.keys(t.mapping).length, 0);
  return (
    <div className="mt-1">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="inline-flex cursor-pointer items-center gap-1 text-[13px] text-muted hover:text-ink">
        {mapped} columns matched{tables.some((t) => t.remembered) ? " (remembered from last time)" : ""} <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="fade-in mt-3 space-y-6 rounded-xl border border-line p-5">
          {tables.map((t) => (
            <div key={t.sheet}>
              {tables.length > 1 ? <p className="mb-3 text-sm font-medium">{t.sheet} <span className="font-normal text-muted">· {t.rows} rows</span></p> : null}
              <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
                {t.fields.map((f) => (
                  <label key={f.key} className="flex items-center justify-between gap-3 text-[13px]">
                    <span className="text-muted">{f.label}</span>
                    <select
                      className="h-8 w-[170px] rounded-md border border-line bg-white px-2 text-[13px]"
                      value={maps[t.sheet]?.[f.key] ?? ""}
                      onChange={(e) => setMaps((m) => {
                        const next = { ...m[t.sheet] };
                        if (e.target.value) next[f.key] = e.target.value; else delete next[f.key];
                        return { ...m, [t.sheet]: next };
                      })}
                    >
                      <option value="">Not in this file</option>
                      {t.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </label>
                ))}
              </div>
              <Button size="sm" className="mt-4" disabled={busy}
                onClick={() => start(async () => { await saveMapping(fileId, t.sheet, maps[t.sheet] ?? {}); router.refresh(); })}>
                {busy ? <Loader2 className="animate-spin" /> : null} Save and remember
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- review cards
export interface ReviewItem {
  id: string; reason: string; fileName: string; fileId: string; where: string; duplicate: boolean;
  region: { x: number; y: number; w: number; h: number } | null; aspect: number;
  fields: { key: string; label: string; value: string; raw: string; confidence: number; flagged: boolean }[];
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rise rounded-2xl border border-line p-6">{children}</div>;
}

function Crop({ fileId, region, aspect }: { fileId: string; region: NonNullable<ReviewItem["region"]>; aspect: number }) {
  // Show just the handwritten line: scale the page so the region fills the box.
  const px = region.w >= 1 ? 0 : (region.x / (1 - region.w)) * 100;
  const py = region.h >= 1 ? 0 : (region.y / (1 - region.h)) * 100;
  return (
    <div role="img" aria-label="The handwritten line this was read from" className="w-full rounded-lg border border-line"
      style={{
        aspectRatio: `${(region.w * aspect) / region.h}`, backgroundImage: `url(/api/files/${fileId})`,
        backgroundSize: `${100 / region.w}% ${100 / region.h}%`, backgroundPosition: `${px}% ${py}%`, backgroundRepeat: "no-repeat",
      }} />
  );
}

export function ReviewCard({ item }: { item: ReviewItem }) {
  const router = useRouter();
  const [fixing, setFixing] = useState(false);
  const [fixes, setFixes] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, start] = useTransition();
  const act = (decision: "accept" | "reject" | "fix") => start(async () => {
    const res = await reviewRow(item.id, decision, fixes);
    if (res.error) setError(res.error); else router.refresh();
  });
  const flagged = item.fields.filter((f) => f.flagged);
  return (
    <Card>
      <p className="font-medium">{item.reason}</p>
      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        <div>
          <p className="mb-2 text-[13px] text-muted">From {item.fileName} · {item.where}</p>
          {item.region ? <Crop fileId={item.fileId} region={item.region} aspect={item.aspect} /> : (
            <dl className="rounded-lg bg-wash p-4 font-mono text-[13px] leading-relaxed">
              {item.fields.filter((f) => f.raw).map((f) => (
                <div key={f.key} className="flex gap-3"><dt className="w-[120px] shrink-0 text-muted">{f.label}</dt><dd className={cn(f.flagged && "font-semibold")}>{f.raw}</dd></div>
              ))}
            </dl>
          )}
        </div>
        <div>
          <p className="mb-2 text-[13px] text-muted">What Tally read</p>
          <dl className="grid grid-cols-[130px_1fr] gap-y-1.5 text-sm">
            {item.fields.map((f) => (
              <div key={f.key} className="contents">
                <dt className="text-muted">{f.label}</dt>
                <dd className="flex items-center gap-2">
                  {fixing && f.flagged ? (
                    <input autoFocus aria-label={f.label} defaultValue={f.value === "—" ? "" : f.value.replace(/^\$/, "")} placeholder={/date|end|start/i.test(f.key) ? "MM/DD/YYYY" : ""}
                      onChange={(e) => setFixes((x) => ({ ...x, [f.key]: e.target.value }))}
                      className="h-8 w-[170px] rounded-md border border-line px-2 text-sm" />
                  ) : (
                    <span className={cn("num", f.flagged && "font-semibold")}>{f.value}</span>
                  )}
                  {f.flagged && !fixing ? <span className="rounded-full bg-wash px-2 py-0.5 text-[11px] text-muted">{f.confidence > 0 ? `${Math.round(f.confidence * 100)}% sure` : "couldn't read"}</span> : null}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
      {error ? <p className="mt-3 text-sm text-danger" role="alert">{error}</p> : null}
      <div className="mt-5 flex flex-wrap gap-2">
        {fixing ? (
          <>
            <Button size="sm" variant="primary" disabled={busy} onClick={() => act("fix")}>Save correction</Button>
            <Button size="sm" variant="ghost" onClick={() => setFixing(false)}>Cancel</Button>
          </>
        ) : item.duplicate ? (
          <>
            <Button size="sm" disabled={busy} onClick={() => act("reject")}>Remove the extra copy</Button>
          </>
        ) : (
          <>
            <Button size="sm" disabled={busy} onClick={() => act("accept")}>{flagged.some((f) => f.confidence === 0) ? "Skip this value" : "Looks right"}</Button>
            {flagged.length ? <Button size="sm" disabled={busy} onClick={() => setFixing(true)}>Fix it</Button> : null}
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => act("reject")}>Ignore this record</Button>
          </>
        )}
      </div>
    </Card>
  );
}

export function ConflictCard({ id, unit, field, working, candidates }: {
  id: string; unit: string; field: string; working: string; candidates: { value: string; display: string; sourceName: string }[];
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  // one button per distinct value, listing the files that say it
  const groups = [...new Set(candidates.map((c) => c.value))].map((v) => ({ value: v, display: candidates.find((c) => c.value === v)!.display, sources: candidates.filter((c) => c.value === v).map((c) => c.sourceName) }));
  return (
    <Card>
      <p className="font-medium">Unit {unit}: your files disagree about the {field.toLowerCase()}</p>
      <p className="mt-1 text-sm text-muted">Tally is using {working} for now and won&apos;t pick for you.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {groups.map((g) => (
          <button key={g.value} type="button" disabled={busy} onClick={() => start(async () => { await resolveConflict(id, g.value); router.refresh(); })}
            className="cursor-pointer rounded-xl border border-line p-4 text-left transition-colors hover:border-accent hover:bg-accent-soft disabled:opacity-50">
            <span className="num block text-2xl font-semibold">{g.display}</span>
            <span className="mt-1 block text-[13px] text-muted">{g.sources.join(" · ")}</span>
            <span className="mt-3 block text-[13px] font-medium text-accent">Use this</span>
          </button>
        ))}
      </div>
    </Card>
  );
}

export function DepositCard({ stagedRowId, date, amount, payer, method, reason }: { stagedRowId: string; date: string; amount: string; payer: string; method: string; reason: string }) {
  const router = useRouter();
  const [unit, setUnit] = useState("");
  const [error, setError] = useState("");
  const [busy, start] = useTransition();
  return (
    <Card>
      <p className="font-medium"><span className="num">{amount}</span> deposit on {date} isn&apos;t matched to anyone</p>
      <p className="mt-1 text-sm text-muted">{method}{payer ? ` from ${payer}` : ""}. {reason}</p>
      <form className="mt-4 flex flex-wrap items-center gap-2" onSubmit={(e) => {
        e.preventDefault();
        start(async () => { const r = await assignDeposit(stagedRowId, unit); if (r.error) setError(r.error); else router.refresh(); });
      }}>
        <label className="text-sm text-muted" htmlFor={`u-${stagedRowId}`}>It belongs to unit</label>
        <input id={`u-${stagedRowId}`} value={unit} onChange={(e) => setUnit(e.target.value)} className="h-8 w-[90px] rounded-md border border-line px-2 text-sm" />
        <Button size="sm" type="submit" disabled={busy || !unit.trim()}>Match it</Button>
        <span className="text-[13px] text-muted">or leave it — it stays out of everyone&apos;s balance.</span>
      </form>
      {error ? <p className="mt-2 text-sm text-danger" role="alert">{error}</p> : null}
    </Card>
  );
}

export function BuildButton({ label }: { label: string }) {
  const [busy, start] = useTransition();
  return (
    <Button variant="primary" size="lg" disabled={busy} onClick={() => start(() => buildNow())}>
      {busy ? <Loader2 className="animate-spin" /> : null} {label} <ArrowRight />
    </Button>
  );
}
