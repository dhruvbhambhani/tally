import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Nav } from "@/components/nav";
import { getContext, getProperties } from "@/lib/context";
import { formatDate } from "@/lib/dates";
import { SHARED_HOST } from "@/lib/session";
import { REPO_URL } from "@/lib/site";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "Tally — your rent roll, finally in one place",
  description: "Free, open-source rent roll. Tally reads your spreadsheets, PDFs, bank statements and paper ledgers and builds one clean, verified rent roll.",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const { all, current } = await getProperties();
  const ctx = await getContext();
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        {SHARED_HOST ? (
          <p className="bg-wash px-6 py-2 text-center text-[13px] text-muted">
            Public demo: anything you add is private to this browser and temporary.{" "}
            <a href={`${REPO_URL}#run-your-own-copy`} className="font-medium text-ink underline underline-offset-2">Run your own free copy</a> to keep your data.
          </p>
        ) : null}
        <Nav builtId={ctx?.data.property.id ?? null} currentId={current?.id ?? null} properties={all.map((p) => ({ id: p.id, name: p.name }))} />
        <main className="flex-1">{children}</main>
        <footer className="border-t border-line">
          <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-x-6 gap-y-1 px-6 py-5 text-[13px] text-muted lg:px-10">
            <span>Not legal or financial advice.</span>
            <span>
              {ctx ? `Data through ${formatDate(ctx.a.asOf)} · ` : ""}
              <a href={REPO_URL} className="underline underline-offset-2 hover:text-ink">Free and open source</a>
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
