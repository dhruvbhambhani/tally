import { eq } from "drizzle-orm";
import { CircleCheck } from "lucide-react";
import { Hint } from "@/components/ui/hint";
import { getProvider } from "@/lib/ai/provider";
import { getProperties } from "@/lib/context";
import { formatDate } from "@/lib/dates";
import { conflicts, payments, sourceFiles, stagedRows, units } from "@/lib/db/schema";
import { KIND_LABELS, type FileKind, type TableMeta } from "@/lib/ingest/stage";
import { FIELD_LABELS, fieldsForKind } from "@/lib/ingest/tabular";
import { money } from "@/lib/money";
import { SHARED_HOST } from "@/lib/session";
import { BuildButton, ConflictCard, DepositCard, DropZone, FileActions, LinkImport, MappingEditor, ReviewCard, type ReviewItem } from "./parts";

export const dynamic = "force-dynamic";

const FIELD_NAMES: Record<string, string> = { ...FIELD_LABELS, name: "Name", leaseEnd: "Lease end", start: "Lease start", end: "Lease end" };

function show(field: string, value: unknown): string {
  if (value == null || value === "") return "—";
  if (typeof value === "number" && /amount|rent|deposit|pet|parking|storage|utilities|concession$|subsidy|fee|portion|premium/i.test(field)) return money(value);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return formatDate(value);
  return String(value);
}

export default async function ImportPage() {
  const { db, current: property } = await getProperties();
  const pid = property?.id ?? "";
  const files = pid ? db.select().from(sourceFiles).where(eq(sourceFiles.propertyId, pid)).all().sort((a, b) => a.name.localeCompare(b.name)) : [];
  const fileById = new Map(files.map((f) => [f.id, f]));
  const staged = pid ? db.select().from(stagedRows).where(eq(stagedRows.propertyId, pid)).all() : [];
  const review = staged.filter((r) => r.status === "needs_review");
  const openConflicts = pid ? db.select().from(conflicts).where(eq(conflicts.propertyId, pid)).all().filter((c) => c.status === "open") : [];
  const unmatched = pid ? db.select().from(payments).where(eq(payments.propertyId, pid)).all().filter((p) => !p.leaseId) : [];
  const built = pid ? db.select().from(units).where(eq(units.propertyId, pid)).all().length > 0 : false;
  const toReview = review.length + openConflicts.length + unmatched.length;
  const demo = (await getProvider()).demo;

  const items: ReviewItem[] = review.map((r) => {
    const file = fileById.get(r.sourceFileId)!;
    const loc = r.locator as { sheet?: string; row?: number; page?: number; region?: { x: number; y: number; w: number; h: number } };
    const isDup = r.data.duplicateOf != null;
    const fields = Object.entries(r.data)
      .filter(([k]) => k !== "duplicateOf" && k !== "mtm")
      .map(([k, c]) => ({ key: k, label: FIELD_NAMES[k] ?? k, value: show(k, c.value), raw: c.raw ?? "", confidence: c.confidence, flagged: c.confidence < 0.8 }));
    return {
      id: r.id, reason: r.reviewReason ?? "", fileName: file.name, fileId: file.id, duplicate: isDup,
      where: loc.region ? "Handwritten line" : loc.page ? `Page ${loc.page}` : `${loc.sheet && loc.sheet !== "CSV" ? loc.sheet + ", " : ""}row ${loc.row}`,
      region: loc.region ?? null,
      aspect: file.meta.width && file.meta.height ? Number(file.meta.width) / Number(file.meta.height) : 1.44,
      fields: r.kind === "rent_roll" ? fields.filter((f) => f.flagged || ["unit", "tenant", "rent", "leaseEnd"].includes(f.key)) : fields,
    };
  });

  return (
    <div className="mx-auto max-w-[1440px] px-6 py-14 lg:px-10">
      <p className="text-sm text-muted">Add your data{property ? ` · ${property.name}` : ""}</p>
      {files.length ? (
        <h1 className="mt-2 text-5xl font-semibold tracking-tight sm:text-6xl">
          <span className="num">{toReview}</span> <span className="text-muted font-normal text-3xl sm:text-4xl">{toReview === 1 ? "thing" : "things"} to check</span>
        </h1>
      ) : (
        <h1 className="mt-2 max-w-[18ch] text-5xl font-semibold tracking-tight sm:text-6xl">Drop in whatever you have.</h1>
      )}
      <p className="mt-4 max-w-[60ch] text-muted">
        {files.length
          ? "Tally read your files. Anything it wasn't sure about is below — nothing is guessed. You can build the rent roll now and come back to these."
          : "Rent roll exports, spreadsheets, bank statements, leases, photos of ledgers. Mix them — Tally sorts out which is which."}
      </p>

      <div className="mt-10"><DropZone hasFiles={files.length > 0} demo={demo} maxMb={SHARED_HOST ? 4 : 25} /></div>
      <LinkImport />
      <details className="group mt-4 max-w-[80ch] text-sm">
        <summary className="cursor-pointer list-none font-medium underline-offset-4 hover:underline">How do I get my data out of my software?</summary>
        <div className="fade-in mt-3 space-y-2 text-muted">
          <p>Export your rent roll as CSV or Excel and drop it here. Tally recognizes the column names these programs use and remembers any you correct.</p>
          <ul className="list-disc space-y-1 pl-5">
            <li><span className="text-ink">AppFolio, Buildium, Yardi, Rent Manager, RealPage, Entrata</span>: run the rent roll report and export it as CSV or Excel.</li>
            <li><span className="text-ink">Bank, Zelle, Venmo, Cash App</span>: download the month&apos;s activity as CSV.</li>
            <li><span className="text-ink">Google Sheets</span>: paste the sheet&apos;s link above, and refresh it any time to pull in changes.</li>
            <li><span className="text-ink">Paper</span>: take a photo of each ledger or receipt-book page.</li>
          </ul>
          <p>Tally doesn&apos;t log in to these programs for you. Nothing is fetched except the links you paste.</p>
        </div>
      </details>

      {files.length ? (
        <>
          <section className="mt-14">
            <h2 className="text-lg font-semibold">Your files</h2>
            <ul className="mt-4 divide-y divide-line border-y border-line">
              {files.map((f) => {
                const tables = ((f.meta.tables as TableMeta[] | undefined) ?? []).filter((t) => t.kind !== "unknown");
                const rows = staged.filter((r) => r.sourceFileId === f.id).length;
                const note = f.meta.note as string | undefined;
                return (
                  <li key={f.id} className="py-4">
                    <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
                      <CircleCheck className={f.status === "parsed" ? "size-4 text-accent" : "size-4 text-muted"} aria-hidden />
                      <span className="min-w-[260px] flex-1 font-medium">{f.name}</span>
                      <span className="w-[230px] text-sm text-muted">{KIND_LABELS[f.kind as FileKind] ?? f.kind}</span>
                      <span className="num w-[110px] text-right text-sm text-muted">{f.status === "parsed" ? `${rows} ${rows === 1 ? "record" : "records"}` : "Not read"}</span>
                      <FileActions fileId={f.id} name={f.name} linked={!!f.meta.link} />
                    </div>
                    {note && f.status !== "parsed" ? <p className="mt-1 pl-10 text-sm text-muted">{note}</p> : null}
                    {tables.length ? (
                      <div className="pl-10">
                        <MappingEditor
                          fileId={f.id}
                          tables={tables.map((t) => ({
                            sheet: t.sheet, headers: t.headers.filter(Boolean), mapping: t.mapping, remembered: t.remembered, rows: t.rows,
                            fields: fieldsForKind(t.kind).map((k) => ({ key: k, label: FIELD_LABELS[k] ?? k })),
                          }))}
                        />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="mt-14" id="review">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              Review queue
              <Hint>Anything Tally couldn&apos;t read with confidence, sources that disagree, and deposits it couldn&apos;t tie to a resident. Tally keeps using its best reading until you decide, and marks the value as unverified.</Hint>
            </h2>
            {toReview === 0 ? (
              <p className="mt-4 text-muted">Nothing to check. Every value was read cleanly and every deposit is matched.</p>
            ) : (
              <div className="mt-4 space-y-4">
                {openConflicts.map((c) => (
                  <ConflictCard key={c.id} id={c.id} unit={c.unitNumber} field={FIELD_NAMES[c.field === "rent" ? "rent" : c.field] ?? c.field}
                    working={c.candidates.find((x) => String(x.value) === c.workingValue)?.display ?? c.workingValue ?? ""}
                    candidates={c.candidates.map((x) => ({ value: String(x.value), display: x.display, sourceName: x.sourceName }))} />
                ))}
                {items.map((it) => <ReviewCard key={it.id} item={it} />)}
                {unmatched.map((p) => (
                  <DepositCard key={p.id} stagedRowId={p.stagedRowId ?? ""} date={formatDate(p.date)} amount={money(p.amount)} payer={p.payer} method={p.method} reason={p.matchReason} />
                ))}
              </div>
            )}
          </section>

          <div className="sticky bottom-0 mt-14 -mx-6 border-t border-line bg-white/95 px-6 py-4 backdrop-blur lg:-mx-10 lg:px-10">
            <div className="flex items-center justify-between gap-6">
              <p className="text-sm text-muted">{built ? "Your rent roll is built. Rebuild any time you add files." : "Ready when you are."}</p>
              <BuildButton label={built ? "Rebuild rent roll" : "Build rent roll"} />
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
