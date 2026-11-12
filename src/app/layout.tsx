import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Nav } from "@/components/nav";
import { getContext } from "@/lib/context";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "Tally — your rent roll, finally in one place",
  description: "Tally reads your spreadsheets, PDFs, bank statements and paper ledgers and builds one clean, verified rent roll.",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const ctx = await getContext();
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <Nav propertyId={ctx?.data.property.id ?? null} />
        <main className="flex-1">{children}</main>
        <footer className="border-t border-line">
          <div className="mx-auto flex max-w-[1440px] items-center justify-between px-6 py-5 text-[13px] text-muted lg:px-10">
            <span>Not legal or financial advice.</span>
            {ctx ? <span>Data through {new Date(ctx.a.asOf + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}</span> : null}
          </div>
        </footer>
      </body>
    </html>
  );
}
