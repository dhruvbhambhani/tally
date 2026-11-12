import Link from "next/link";
import { ArrowRight, FileSpreadsheet, FileText, Landmark, NotebookPen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getContext } from "@/lib/context";

export const dynamic = "force-dynamic";

export default async function Home() {
  const ctx = await getContext();
  return (
    <div className="mx-auto flex max-w-[1440px] flex-col items-start px-6 py-24 lg:px-10 lg:py-36">
      <h1 className="rise max-w-[14ch] text-5xl font-semibold leading-[1.05] tracking-tight sm:text-7xl">
        Your rent roll, finally in one place.
      </h1>
      <p className="rise mt-6 max-w-[52ch] text-lg text-muted" style={{ animationDelay: "60ms" }}>
        Drop in whatever you have. Tally reads it, checks it, and shows what your property really earns, who owes you, and what to do this week.
      </p>
      <div className="rise mt-10 flex flex-wrap items-center gap-6" style={{ animationDelay: "120ms" }}>
        <Button asChild variant="primary" size="lg">
          <Link href="/import">Add your data <ArrowRight /></Link>
        </Button>
        {ctx ? (
          <Link href={`/property/${ctx.data.property.id}`} className="text-sm font-medium text-ink underline-offset-4 hover:underline">
            Open {ctx.data.property.name}
          </Link>
        ) : null}
      </div>
      <ul className="rise mt-20 grid w-full max-w-[880px] grid-cols-2 gap-x-10 gap-y-6 text-sm text-muted sm:grid-cols-4" style={{ animationDelay: "180ms" }}>
        {[
          [FileSpreadsheet, "Spreadsheets and software exports"],
          [Landmark, "Bank, Zelle, Venmo and Cash App"],
          [FileText, "Lease PDFs"],
          [NotebookPen, "Photos of paper ledgers"],
        ].map(([Icon, label]) => {
          const I = Icon as typeof FileText;
          return (
            <li key={label as string} className="flex items-start gap-3">
              <I className="mt-0.5 size-4 shrink-0 text-ink" aria-hidden />
              <span>{label as string}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
