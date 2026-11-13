import { createProperty, deleteProperty, updateSettings } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { getProvider } from "@/lib/ai/provider";
import { getProperties } from "@/lib/context";
import { availableNotices, loadNoticeConfig } from "@/lib/delinquency/notices";
import { aiKey, SHARED_HOST } from "@/lib/session";
import { resolveSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";
import { AiKeyForm, EraseEverything, PropertySwitch } from "./parts";

export const dynamic = "force-dynamic";

const input = "h-10 w-full rounded-lg border border-line bg-white px-3 text-sm";

function Field({ label, hint, children, className }: { label: string; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="flex items-center gap-1.5 text-[13px] text-muted">{label}{hint ? <Hint>{hint}</Hint> : null}</span>
      {children}
    </label>
  );
}

function Section({ id, title, blurb, children }: { id: string; title: string; blurb?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="grid scroll-mt-24 gap-6 border-t border-line py-10 lg:grid-cols-[300px_1fr]">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {blurb ? <p className="mt-1 text-sm text-muted">{blurb}</p> : null}
      </div>
      <div className="grid max-w-[760px] gap-5 sm:grid-cols-2">{children}</div>
    </section>
  );
}

export default async function SettingsPage(props: PageProps<"/settings">) {
  const sp = await props.searchParams;
  const { all, current: p } = await getProperties();
  const s = resolveSettings(p?.settings);
  const notices = availableNotices(p?.state ?? "");
  const own = await aiKey();
  const cfg = loadNoticeConfig();
  const provider = await getProvider();

  return (
    <div className="mx-auto max-w-[1440px] px-6 py-14 lg:px-10">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="text-sm text-muted">Settings</p>
          <h1 className="mt-2 text-5xl font-semibold tracking-tight sm:text-6xl">{p?.name ?? "Settings"}</h1>
          {sp.saved ? <p className="mt-3 text-sm text-accent" role="status">Saved.</p> : null}
          {sp.deleted ? <p className="mt-3 text-sm text-accent" role="status">Property deleted.</p> : null}
        </div>
        {p ? <Button type="submit" form="settings-form" variant="primary" size="lg">Save changes</Button> : null}
      </div>

      <div className="mt-10">
        <section id="ai" className="grid scroll-mt-24 gap-6 border-t border-line py-10 lg:grid-cols-[300px_1fr]">
          <div>
            <h2 className="text-lg font-semibold">Your AI key</h2>
            <p className="mt-1 text-sm text-muted">Optional. Tally is free; with your own key it can also read handwriting and unusual leases, and polish letters.</p>
          </div>
          <div className="max-w-[760px]">
            <AiKeyForm
              current={own ? { provider: own.provider, last4: own.apiKey.slice(-4), model: own.model ?? "" } : null}
              serverKey={!own && !provider.demo ? provider.name : null}
            />
            <ul className="mt-5 list-disc space-y-1 pl-5 text-[13px] text-muted">
              <li>Your key stays in this browser as a secure cookie. It is not saved in Tally&apos;s database and is never shown again.</li>
              <li>It is sent only to the provider you choose, and only when Tally reads a file, routes a question or words a letter. You pay that provider directly for what you use.</li>
              <li>AI reads documents and writes words. It never calculates a number.</li>
            </ul>
          </div>
        </section>

        {p ? <form id="settings-form" action={updateSettings}>
        <Section id="property" title="Property" blurb="Used on letters and to pick the right notice templates.">
          <Field label="Name"><input name="name" defaultValue={p.name} className={input} /></Field>
          <Field label="Your name (signs letters)"><input name="ownerName" defaultValue={s.ownerName} className={input} /></Field>
          <Field label="Street address" className="sm:col-span-2"><input name="address" defaultValue={p.address} className={input} /></Field>
          <Field label="City"><input name="city" defaultValue={p.city} className={input} /></Field>
          <Field label="State"><input name="state" defaultValue={p.state} maxLength={2} className={cn(input, "w-[90px] uppercase")} /></Field>
        </Section>

        <Section id="legal" title="Rules that apply here" blurb="These change what Tally will suggest and which notices it will prepare.">
          <Field label="Covered by the CARES Act?" className="sm:col-span-2"
            hint="A property is generally covered if it has a federally backed mortgage (FHA, VA, USDA, Fannie Mae, Freddie Mac) or takes part in a federal housing program such as vouchers or tax credits. Covered properties must give at least 30 days' notice to vacate for nonpayment. If you're not sure, leave this on 'Not sure' and Tally will treat it as covered.">
            <select name="caresCovered" defaultValue={p.caresCovered} className={cn(input, "max-w-[360px]")}>
              <option value="unknown">Not sure — treat it as covered</option>
              <option value="yes">Yes, covered</option>
              <option value="no">No, not covered</option>
            </select>
          </Field>
          <Field label="Rent control" hint="Turn on if a state or local law limits how much you can raise rent each year. Tally then caps every suggested increase at the percentage you enter.">
            <span className="flex h-10 items-center gap-3 text-sm"><input type="checkbox" name="rentControl" defaultChecked={p.rentControl} className="size-4 accent-[#0F766E]" /> Rent increases are capped by law here</span>
          </Field>
          <Field label="Legal cap on yearly increase (%)"><input name="rentControlCapPct" defaultValue={p.rentControlCapPct ?? ""} inputMode="decimal" placeholder="e.g. 5" className={cn(input, "w-[140px]")} /></Field>
          <Field label="Rent suggestions" hint="Some cities and states restrict software that recommends rents. Turn this off and Tally will stop suggesting renewal rents for this property. It never uses other owners' private data either way.">
            <span className="flex h-10 items-center gap-3 text-sm"><input type="checkbox" name="pricingSuggestions" defaultChecked={p.pricingSuggestions} className="size-4 accent-[#0F766E]" /> Suggest renewal rents</span>
          </Field>
          <Field label="Most you'd raise rent at renewal (%)" hint="Your own ceiling. Suggested renewal rents never go above this, above your market rent, or above a legal cap.">
            <input name="maxIncreasePct" defaultValue={p.maxIncreasePct} inputMode="decimal" className={cn(input, "w-[140px]")} />
          </Field>
        </Section>

        <Section id="late-fee" title="Late fees" blurb="One rule, applied to everyone the same way. Only charge what your leases allow.">
          <Field label="Rent is late after day" hint="The last day of the month rent can arrive without being late. Rent received after this day counts as late."><input name="lateFeeGraceDay" defaultValue={p.lateFeeGraceDay} inputMode="numeric" className={cn(input, "w-[140px]")} /></Field>
          <Field label="Late fee"><input name="lateFeeAmount" defaultValue={`$${(p.lateFeeAmount / 100).toFixed(2)}`} className={cn(input, "w-[140px]")} /></Field>
        </Section>

        <Section id="ladder" title="Collection steps" blurb="Tally suggests the next step once a balance is this many days late.">
          {s.ladder.map((step) => (
            <Field key={step.key} label={`${step.label}${step.requiresApproval ? " (needs your approval)" : ""}`}>
              <span className="flex items-center gap-2 text-sm text-muted">after <input name={`ladder_${step.key}`} defaultValue={step.afterDays} inputMode="numeric" className={cn(input, "w-[90px] text-ink")} /> days late</span>
            </Field>
          ))}
          <Field label="Payment-plan length (months)"><input name="paymentPlanMonths" defaultValue={s.paymentPlanMonths} inputMode="numeric" className={cn(input, "w-[90px]")} /></Field>
        </Section>

        <Section id="letters" title="Letters" blurb="Every friendly letter includes this line about rental assistance.">
          <Field label="Rental-assistance line (English)" className="sm:col-span-2"><textarea name="rentalAssistanceText" defaultValue={s.rentalAssistanceText} rows={2} className={cn(input, "h-auto py-2")} /></Field>
          <Field label="Rental-assistance line (Spanish)" className="sm:col-span-2"><textarea name="rentalAssistanceTextEs" defaultValue={s.rentalAssistanceTextEs} rows={2} className={cn(input, "h-auto py-2")} /></Field>
        </Section>

        <section id="notices" className="grid scroll-mt-24 gap-6 border-t border-line py-10 lg:grid-cols-[300px_1fr]">
          <div>
            <h2 className="text-lg font-semibold">Formal notice templates</h2>
            <p className="mt-1 text-sm text-muted">Samples only. Have your attorney review them before use.</p>
          </div>
          <div className="max-w-[760px] text-sm">
            {notices.length ? (
              <ul className="divide-y divide-line border-y border-line">
                {notices.map((n) => (
                  <li key={n.type} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <span className="font-medium">{n.title}</span>
                    <span className="text-muted">{n.days}-day notice · templates/notices/{n.templateState}/{n.type}.txt</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-muted">No templates for {p.state || "this state"} yet.</p>}
            <p className="mt-3 text-muted">
              {p.state && !notices.some((n) => n.templateState === p.state) ? `There is no ${p.state}-specific template yet, so the generic sample is used. ` : ""}
              Notice periods are read from config/notice-periods.json, and are never shorter than {cfg.caresMinimumDays} days while the property is, or may be, covered by the CARES Act. The README explains how to add your state.
            </p>
          </div>
        </section>

        <Section id="benchmarks" title="Typical ranges" blurb="Tally flags a number when it falls outside these. The starting ranges are rules of thumb — set your own.">
          <Field label="Below-market leases, % of possible rent" hint="Loss-to-lease as a share of gross potential rent.">
            <span className="flex items-center gap-2 text-sm text-muted"><input name="ltlMin" defaultValue={s.benchmarks.lossToLeasePct.min} className={cn(input, "w-[80px] text-ink")} /> to <input name="ltlMax" defaultValue={s.benchmarks.lossToLeasePct.max} className={cn(input, "w-[80px] text-ink")} /> %</span>
          </Field>
          <Field label="Where this range comes from"><input name="ltlSource" defaultValue={s.benchmarks.lossToLeasePct.source} className={input} /></Field>
          <Field label="Gap between occupied and paid, points" hint="Physical occupancy minus economic occupancy.">
            <span className="flex items-center gap-2 text-sm text-muted"><input name="gapMin" defaultValue={s.benchmarks.occupancyGapPts.min} className={cn(input, "w-[80px] text-ink")} /> to <input name="gapMax" defaultValue={s.benchmarks.occupancyGapPts.max} className={cn(input, "w-[80px] text-ink")} /> pts</span>
          </Field>
          <Field label="Where this range comes from"><input name="gapSource" defaultValue={s.benchmarks.occupancyGapPts.source} className={input} /></Field>
          <Field label="Flag a vacant unit after (days)"><input name="vacancyAlertDays" defaultValue={s.vacancyAlertDays} className={cn(input, "w-[90px]")} /></Field>
          <Field label="Flag a month when more than (%) of leases end"><input name="expirationFlagPct" defaultValue={Math.round(s.expirationFlagShare * 100)} className={cn(input, "w-[90px]")} /></Field>
        </Section>

        </form> : null}

        <section id="properties" className="grid scroll-mt-24 gap-6 border-t border-line py-10 lg:grid-cols-[300px_1fr]">
          <div>
            <h2 className="text-lg font-semibold">Your properties</h2>
            <p className="mt-1 text-sm text-muted">Each property has its own files, rent roll and settings.</p>
          </div>
          <div className="max-w-[760px] text-sm">
            {all.length ? (
              <ul className="divide-y divide-line border-y border-line">
                {all.map((x) => (
                  <li key={x.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <span><span className="font-medium">{x.name}</span> <span className="text-muted">· {x.unitCount ? `${x.unitCount} units` : "no rent roll yet"}{x.id === p?.id ? " · showing now" : ""}</span></span>
                    <span className="flex items-center gap-2">
                      {x.id !== p?.id ? <PropertySwitch id={x.id} /> : null}
                      <details className="relative">
                        <summary className="cursor-pointer list-none rounded-lg px-3 py-1.5 text-[13px] text-muted hover:bg-wash hover:text-ink">Delete</summary>
                        <form action={deleteProperty} className="fade-in absolute right-0 z-10 mt-1 w-[280px] rounded-xl border border-line bg-white p-4 shadow-lg">
                          <input type="hidden" name="id" value={x.id} />
                          <p className="text-[13px] text-muted">Delete {x.name} and all of its files, letters and settings? This can&apos;t be undone.</p>
                          <Button type="submit" size="sm" className="mt-3 border-danger text-danger hover:bg-danger-soft">Delete {x.name}</Button>
                        </form>
                      </details>
                    </span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-muted">No properties yet. Add one here, or just drop files on the Add data page.</p>}
            <form action={createProperty} className="mt-5 flex flex-wrap items-end gap-3">
              <Field label="Add a property"><input name="name" required maxLength={80} placeholder="e.g. Oak Street Apartments" className={cn(input, "w-[300px]")} /></Field>
              <Button type="submit">Add property</Button>
            </form>
          </div>
        </section>

        <section id="data" className="grid scroll-mt-24 gap-6 border-t border-line py-10 lg:grid-cols-[300px_1fr]">
          <div>
            <h2 className="text-lg font-semibold">Your data</h2>
            <p className="mt-1 text-sm text-muted">Where it lives and how to remove it.</p>
          </div>
          <div className="max-w-[760px] text-sm text-muted">
            <p>
              {SHARED_HOST
                ? "This is the public demo. Your files are kept in a private, temporary workspace tied to this browser — other visitors can't see them — and they are cleared from time to time. To keep your data, run your own copy of Tally: it's free and open source."
                : "Everything is stored on this computer, in the data folder next to the app (a single SQLite file plus your uploaded files). Back it up by copying that folder."}
            </p>
            <EraseEverything />
          </div>
        </section>
      </div>
    </div>
  );
}
