import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { getProvider } from "@/lib/ai/provider";
import { getContext } from "@/lib/context";
import { money } from "@/lib/money";
import { availableRevenue, buildRecInput, runRecommendations } from "@/lib/recs/engine";

export const dynamic = "force-dynamic";

export default async function EarnMorePage() {
  const ctx = await getContext();
  if (!ctx) redirect("/");
  const { data, a } = ctx;
  const recs = runRecommendations(buildRecInput(data, a));
  const total = availableRevenue(recs);
  const provider = await getProvider();
  // The rules engine computed every figure; the AI may only reword the explanation.
  const explanations = await Promise.all(recs.map((r) =>
    provider.generate({
      task: "recommendation_explanation", language: "en", fallback: r.explanation,
      facts: { title: r.title, action: r.action, math: r.math.join(" | "), monthly: money(r.monthly), yearly: money(r.yearly), oneTime: money(r.oneTime) },
      instructions: "One or two plain sentences for a small apartment owner. No jargon.",
    })));

  return (
    <div className="mx-auto max-w-[1440px] px-6 py-14 lg:px-10">
      <p className="text-sm text-muted">Ways to earn more · {data.property.name}</p>
      <h1 className="rise mt-2 text-3xl font-medium tracking-tight text-muted sm:text-4xl">
        Up to <span className="num block text-6xl font-semibold text-ink sm:text-7xl">{money(total.yearly)}<span className="text-3xl font-medium text-muted sm:text-4xl">/yr</span></span>
        in available revenue
      </h1>
      <p className="mt-4 flex max-w-[64ch] items-center gap-1.5 text-muted">
        {money(total.monthly)} a month across {recs.filter((r) => r.kind === "gain").length} actions{total.oneTime ? `, plus ${money(total.oneTime)} one-time` : ""}.
        <Hint>Every figure is calculated from your own rent roll, leases and payments — never estimated by AI. &quot;Up to&quot; assumes each action is fully carried out. Market rent is whatever you entered or imported; Tally never uses other owners&apos; private data.</Hint>
      </p>
      {!data.property.pricingSuggestions ? (
        <p className="mt-3 text-sm text-muted">Rent suggestions are turned off for this property in Settings, so renewal pricing isn&apos;t shown.</p>
      ) : null}

      <ol className="mt-12 space-y-4">
        {recs.map((r, i) => (
          <li key={r.id} className="rise rounded-2xl border border-line p-7" style={{ animationDelay: `${i * 40}ms` }}>
            <div className="flex flex-wrap items-start justify-between gap-x-10 gap-y-4">
              <div className="max-w-[70ch] flex-1">
                <p className="text-[13px] text-muted">{i + 1} · {r.kind === "gain" ? "New revenue" : r.kind === "protect" ? "Already owed — make sure it happens" : "Worth a look"}</p>
                <h2 className="mt-1 text-xl font-semibold tracking-tight">{r.title}</h2>
                <p className="mt-2">{r.action}</p>
                <p className="mt-2 text-sm text-muted">{explanations[i]}</p>
              </div>
              <div className="text-right">
                {r.yearly > 0 ? (
                  <>
                    <p className="num text-3xl font-semibold tracking-tight">{money(r.yearly)}<span className="text-base font-medium text-muted">/yr</span></p>
                    <p className="num text-sm text-muted">{money(r.monthly)}/mo</p>
                  </>
                ) : r.oneTime > 0 ? (
                  <>
                    <p className="num text-3xl font-semibold tracking-tight">{money(r.oneTime)}</p>
                    <p className="text-sm text-muted">one-time</p>
                  </>
                ) : <p className="text-sm text-muted">No dollar figure</p>}
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[13px] text-muted">{r.units.length === 1 ? "Unit" : "Units"}</span>
              {r.units.slice(0, 14).map((u) => <span key={u} className="num rounded-full bg-wash px-2.5 py-1 text-[12px]">{u}</span>)}
              {r.units.length > 14 ? <span className="text-[12px] text-muted">+{r.units.length - 14} more</span> : null}
            </div>
            <details className="group mt-4">
              <summary className="cursor-pointer list-none text-sm font-medium underline-offset-4 hover:underline">
                <span className="group-open:hidden">Show the math</span><span className="hidden group-open:inline">Hide the math</span>
              </summary>
              <ul className="fade-in mt-3 space-y-1 rounded-xl bg-wash p-4 text-[13px] leading-relaxed">
                {r.math.map((m) => <li key={m} className="num">{m}</li>)}
              </ul>
            </details>
            <div className="mt-5 flex flex-wrap items-center gap-5">
              <Button asChild variant={i === 0 ? "primary" : "outline"}><Link href={r.nextStep.href}>{r.nextStep.label} <ArrowRight /></Link></Button>
              {r.evidence.href !== r.nextStep.href ? <Link href={r.evidence.href} className="text-sm font-medium text-ink underline-offset-4 hover:underline">{r.evidence.label}</Link> : null}
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-8 max-w-[80ch] text-[13px] text-muted">
        Recommendations use lease terms, unit facts and payment timing only — never anything about who a resident is. The same rule is applied to every lease that meets it.
      </p>
    </div>
  );
}
