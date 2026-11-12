import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { ExpirationsChart, TrendChart, WaterfallChart, type WaterfallBar } from "@/components/charts";
import { RentRollTable, type RentRollViewRow } from "@/components/rent-roll-table";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { getContext } from "@/lib/context";
import { dataHealth } from "@/lib/data/load";
import { formatDate } from "@/lib/dates";
import { conflicts, sourceFiles } from "@/lib/db/schema";
import { KIND_LABELS, type FileKind } from "@/lib/ingest/stage";
import { waterfallBars } from "@/lib/metrics/rentroll";
import { money, pct } from "@/lib/money";
import { rentRollCells } from "@/lib/pdf/documents";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

function Stat({ label, hint, value, sub, tone, children }: { label: string; hint: React.ReactNode; value: string; sub?: React.ReactNode; tone?: "danger"; children?: React.ReactNode }) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-[13px] text-muted">{label} <Hint>{hint}</Hint></p>
      <div className="mt-1 flex items-end gap-3">
        <p className={cn("num text-3xl font-semibold tracking-tight", tone === "danger" && "text-danger")}>{value}</p>
        {children}
      </div>
      {sub ? <p className="mt-1 text-[13px] text-muted">{sub}</p> : null}
    </div>
  );
}

export default async function PropertyPage(props: PageProps<"/property/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const ctx = await getContext();
  if (!ctx || ctx.data.property.id !== id) notFound();
  const { data, a, db } = ctx;
  const p = data.property;
  const w = a.waterfall;
  const tab = sp.tab === "expirations" || sp.tab === "data-health" ? sp.tab : "rent-roll";
  const base = `/property/${id}`;

  const bars: WaterfallBar[] = waterfallBars(w.steps);

  const ltl = a.benchmarks.find((b) => b.key === "lossToLeasePct");
  const gap = a.benchmarks.find((b) => b.key === "occupancyGapPts");
  const benchNote = (b: typeof ltl) => b && b.status !== "within" ? `${b.status === "above" ? "Above" : "Below"} the usual ${b.range.min}–${b.range.max}${b.unit === "%" ? "%" : " pts"}` : null;
  const benchHint = (b: typeof ltl) => b ? <> Usual range: {b.range.min}–{b.range.max}{b.unit === "%" ? "%" : " points"}. Source: {b.range.source}</> : null;
  const trend = a.trend.filter((t) => t.rate != null).map((t) => ({ label: formatDate(t.period, "month"), rate: Math.round(t.rate! * 1000) / 10 }));
  const openConflictUnits = new Set(db.select().from(conflicts).where(eq(conflicts.propertyId, id)).all().filter((c) => c.status === "open").map((c) => c.unitNumber));

  const rows: RentRollViewRow[] = a.rentRoll.map((r) => {
    const lease = r.leaseId ? data.leaseById.get(r.leaseId) : null;
    return {
      ...(rentRollCells(r) as unknown as RentRollViewRow), sqft: r.sqft, status: r.status, owes: r.balance > 0,
      belowMarket: r.contractRent != null && r.contractRent < r.marketRent,
      flag: openConflictUnits.has(r.unit) ? "Check rent" : lease?.subsidy ? "Voucher" : "",
    };
  });

  return (
    <div className="mx-auto max-w-[1440px] px-6 py-14 lg:px-10">
      <p className="text-sm text-muted">{p.name} · {formatDate(a.period, "month")}</p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-6">
        <h1 className="rise text-3xl font-medium leading-tight tracking-tight text-muted sm:text-4xl">
          You collected <span className="num block text-6xl font-semibold text-ink sm:text-7xl">{money(w.collected)}</span>
          of {money(w.gpr)} possible this month <span className="num text-ink">({pct(w.economicOccupancy)})</span>
        </h1>
        <Button asChild variant="primary" size="lg"><Link href="/earn-more">See ways to earn more <ArrowRight /></Link></Button>
      </div>

      <section className="mt-12" aria-label="Where the rent went">
        <p className="flex items-center gap-1.5 text-[13px] text-muted">
          Where the rent went
          <Hint>Start with what you&apos;d collect if every unit were rented at your market rent. Subtract empty units, leases below market, discounts, and rent not yet paid. What&apos;s left is what you collected.</Hint>
        </p>
        <WaterfallChart bars={bars} />
      </section>

      <section className="mt-12 grid grid-cols-2 gap-x-8 gap-y-10 border-y border-line py-10 md:grid-cols-3 xl:grid-cols-6" aria-label="Key numbers">
        <Stat label="Occupied" value={pct(a.occupancy.rate)} sub={`${a.occupancy.occupied} of ${a.occupancy.total} units`}
          hint="Physical occupancy: the share of units with someone living in them, including residents who've given notice." />
        <Stat label="Paid" value={pct(w.economicOccupancy)} sub={benchNote(gap) ? `${gap!.value} pts under occupied. ${benchNote(gap)}` : `${gap?.value ?? 0} pts under occupied`}
          hint={<>Economic occupancy: rent actually collected ÷ rent possible if every unit were full at market rent. The gap to &quot;Occupied&quot; is money lost to low rents, discounts and non-payment.{benchHint(gap)}</>} />
        <Stat label="Collection rate" value={pct(a.collection.rate)} sub={`${money(a.collection.collected)} of ${money(a.collection.billed)} billed`}
          hint="Of everything you billed this month (rent plus fees), the share paid so far. The line shows the same figure for earlier months.">
          {trend.length > 1 ? <TrendChart points={trend} /> : null}
        </Stat>
        <Stat label="Below market" value={money(w.lossToLease)} sub={benchNote(ltl) ?? `${ltl?.value ?? 0}% of possible rent, per month`}
          hint={<>Loss-to-lease: how much more you&apos;d collect each month if every occupied unit paid your market rent.{benchHint(ltl)}</>} />
        <Stat label="Owed to you" value={money(a.aging.total)} tone={a.aging.total > 0 ? "danger" : undefined}
          sub={<Link href="/delinquency" className="underline underline-offset-2 hover:text-ink">{a.aging.byLease.length} {a.aging.byLease.length === 1 ? "resident" : "residents"}</Link>}
          hint="Delinquency: unpaid charges that are past due. The voucher share of subsidized rent is not counted against the resident." />
        <Stat label="Renewals due" value={String(a.renewals.d90.length)} sub={`${a.renewals.d30.length} in 30 days · ${a.renewals.d60.length} in 60`}
          hint="Leases ending in the next 90 days where the resident hasn't given notice. Month-to-month residents are counted separately." />
      </section>

      <details className="group mt-6">
        <summary className="cursor-pointer list-none text-sm font-medium text-ink underline-offset-4 hover:underline">
          <span className="group-open:hidden">More numbers</span><span className="hidden group-open:inline">Fewer numbers</span>
        </summary>
        <div className="fade-in mt-8 grid gap-x-8 gap-y-10 md:grid-cols-2 xl:grid-cols-[repeat(4,minmax(0,1fr))_1.6fr]">
          <Stat label="Month-to-month" value={String(a.mtm.length)} sub="residents without a current lease"
            hint="Residents whose lease term has ended and who now rent month to month. They can leave, or be re-priced, on short notice." />
          <Stat label="Other income" value={money(a.otherIncome.perUnit)} sub={`per occupied unit · ${money(a.otherIncome.total)} total`}
            hint="Pet, parking, storage, utility bill-backs and late fees billed this month, divided by occupied units." />
          <Stat label="Deposits held" value={money(a.deposits.held)}
            sub={a.deposits.shortfallTotal > 0 ? `${money(a.deposits.shortfallTotal)} short of lease amounts` : `matches the ${a.deposits.knownCount} leases on file`}
            hint="Security deposits you're holding. 'Required' is only known where a lease is on file, so the comparison covers those leases." />
          <Stat label="Days vacant" value={a.vacancy.avgDays == null ? "—" : String(a.vacancy.avgDays)} sub={`average across ${a.vacancy.units.length} vacant units`}
            hint="Average number of days each currently vacant unit has been empty." />
          <div>
            <p className="flex items-center gap-1.5 text-[13px] text-muted">Unit mix <Hint>How many of each unit type you have, and the average market rent next to the average rent actually being paid.</Hint></p>
            <table className="mt-2 w-full text-sm">
              <thead><tr className="text-left text-[12px] text-muted"><th className="py-1 font-medium">Type</th><th className="py-1 text-right font-medium">Units</th><th className="py-1 text-right font-medium">Market</th><th className="py-1 text-right font-medium">Avg rent</th></tr></thead>
              <tbody>
                {a.unitMix.map((m) => (
                  <tr key={m.unitType} className="border-t border-line"><td className="py-1.5">{m.unitType}</td><td className="num py-1.5 text-right">{m.count}</td><td className="num py-1.5 text-right text-muted">{money(m.avgMarketRent)}</td><td className="num py-1.5 text-right">{money(m.avgContractRent)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </details>

      <nav className="mt-14 flex gap-1 border-b border-line" aria-label="Property sections">
        {[["rent-roll", "Rent roll"], ["expirations", "Expirations"], ["data-health", "Data health"]].map(([k, label]) => (
          <Link key={k} href={`${base}?tab=${k}`} scroll={false} aria-current={tab === k ? "page" : undefined}
            className={cn("-mb-px border-b-2 px-4 py-3 text-sm transition-colors", tab === k ? "border-ink font-medium text-ink" : "border-transparent text-muted hover:text-ink")}>
            {label}
          </Link>
        ))}
      </nav>

      <div className="mt-8">
        {tab === "rent-roll" ? (
          <RentRollTable rows={rows} initialUnits={typeof sp.units === "string" && sp.units ? sp.units.split(",") : []} initialStatus={typeof sp.status === "string" ? sp.status : ""} />
        ) : tab === "expirations" ? (
          <ExpirationsTab ctx={ctx} />
        ) : (
          <DataHealthTab ctx={ctx} />
        )}
      </div>
    </div>
  );
}

function ExpirationsTab({ ctx }: { ctx: NonNullable<Awaited<ReturnType<typeof getContext>>> }) {
  const { a, data } = ctx;
  const flagged = a.expirations.filter((m) => m.flagged);
  const list = (leases: typeof a.mtm) => leases.map((l) => {
    const u = data.unitById.get(l.unitId)!;
    return { unit: u.number, resident: l.residents.join(", "), end: l.end, rent: l.contractRent, market: u.marketRent };
  });
  return (
    <div>
      <p className="flex items-center gap-1.5 text-[13px] text-muted">
        Leases ending each month
        <Hint>Months shown in black have more than {Math.round(data.settings.expirationFlagShare * 100)}% of your units expiring at once — a few move-outs in the same month can leave several units empty together.</Hint>
      </p>
      <ExpirationsChart months={a.expirations.map((m) => ({ label: formatDate(m.period, "month").replace(" 20", " ’"), count: m.count, flagged: m.flagged }))} />
      {flagged.length ? (
        <p className="mt-4 text-sm">
          {flagged.map((m) => `${m.count} leases (${pct(m.share, 0)} of units) end in ${formatDate(m.period, "month")}`).join("; ")}.{" "}
          <Link href="/earn-more" className="font-medium text-accent underline-offset-4 hover:underline">How to spread them out</Link>
        </p>
      ) : null}
      <div className="mt-10 grid gap-10 lg:grid-cols-2">
        {[{ title: "Renewals due in the next 90 days", rows: list(a.renewals.d90), empty: "No leases end in the next 90 days." },
          { title: "Month-to-month", rows: list(a.mtm), empty: "Nobody is month-to-month." }].map((sec) => (
          <div key={sec.title}>
            <h3 className="font-semibold">{sec.title}</h3>
            {sec.rows.length ? (
              <table className="mt-3 w-full text-sm">
                <thead><tr className="text-left text-[12px] text-muted"><th className="py-2 font-medium">Unit</th><th className="py-2 font-medium">Resident</th><th className="py-2 font-medium">Lease ended / ends</th><th className="py-2 text-right font-medium">Rent</th><th className="py-2 text-right font-medium">Market</th></tr></thead>
                <tbody>
                  {sec.rows.sort((x, y) => (x.end ?? "").localeCompare(y.end ?? "")).map((r) => (
                    <tr key={r.unit} className="border-t border-line"><td className="py-2 font-medium">{r.unit}</td><td className="py-2">{r.resident}</td><td className="py-2 text-muted">{formatDate(r.end)}</td><td className="num py-2 text-right">{money(r.rent)}</td><td className="num py-2 text-right text-muted">{money(r.market)}</td></tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="mt-3 text-sm text-muted">{sec.empty}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

function DataHealthTab({ ctx }: { ctx: NonNullable<Awaited<ReturnType<typeof getContext>>> }) {
  const { db, data } = ctx;
  const h = dataHealth(db, data.property.id);
  const files = db.select().from(sourceFiles).where(eq(sourceFiles.propertyId, data.property.id)).all().sort((x, y) => x.name.localeCompare(y.name));
  const toCheck = h.openConflicts + h.unmatchedDeposits + h.reviewItems;
  return (
    <div>
      <div className="grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Data health" value={`${h.score}`} sub="out of 100"
          hint="Starts at the share of fields Tally read with confidence. Each unresolved conflict costs 2 points; each unmatched deposit or unreviewed item costs 1." />
        <Stat label="Fields verified" value={pct(h.verifiedShare, 0)} sub={`${h.verified} of ${h.fields} fields`}
          hint="Verified means two of your files agree on the value, or you confirmed it yourself. The rest were read from a single file." />
        <Stat label="Conflicts" value={String(h.openConflicts)} sub="files that disagree"
          hint="Places where two of your files give different values, like a lease and a rent roll showing different rents. Tally never picks for you." />
        <Stat label="Unmatched deposits" value={String(h.unmatchedDeposits)} sub="not tied to a resident"
          hint="Deposits in your bank or payment-app export that Tally couldn't confidently connect to a resident. They aren't counted toward anyone's rent." />
      </div>
      {toCheck ? (
        <p className="mt-8 text-sm">
          {toCheck} {toCheck === 1 ? "thing needs" : "things need"} a look.{" "}
          <Link href="/import#review" className="font-medium text-accent underline-offset-4 hover:underline">Open the review queue</Link>
        </p>
      ) : null}
      <h3 className="mt-10 font-semibold">Where your numbers come from</h3>
      <ul className="mt-3 divide-y divide-line border-y border-line text-sm">
        {files.map((f) => (
          <li key={f.id} className="flex flex-wrap items-center gap-x-6 py-3">
            <span className="min-w-[260px] flex-1 font-medium">{f.name}</span>
            <span className="w-[240px] text-muted">{KIND_LABELS[f.kind as FileKind] ?? f.kind}</span>
            <span className="w-[140px] text-right text-muted">{f.status === "parsed" ? "Read" : "Not read"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
