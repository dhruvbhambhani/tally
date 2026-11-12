"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function Nav({ propertyId }: { propertyId: string | null }) {
  const path = usePathname();
  const links = [
    { href: propertyId ? `/property/${propertyId}` : "/import", label: "Property", match: "/property" },
    { href: "/earn-more", label: "Earn more", match: "/earn-more" },
    { href: "/delinquency", label: "Who owes", match: "/delinquency" },
    { href: "/ask", label: "Ask Tally", match: "/ask" },
    { href: "/import", label: "Add data", match: "/import" },
    { href: "/settings", label: "Settings", match: "/settings" },
  ];
  return (
    <header className="border-b border-line">
      <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between gap-6 px-6 lg:px-10">
        <Link href="/" className="flex items-center gap-2 text-[17px] font-semibold tracking-tight">
          <span aria-hidden className="grid size-6 place-items-center rounded-md bg-accent text-[13px] font-bold text-white">T</span>
          Tally
        </Link>
        {propertyId ? (
          <nav aria-label="Main" className="flex items-center gap-1 overflow-x-auto text-sm">
            {links.map((l) => {
              const active = path.startsWith(l.match);
              return (
                <Link
                  key={l.label}
                  href={l.href}
                  aria-current={active ? "page" : undefined}
                  className={cn("whitespace-nowrap rounded-lg px-3 py-2 transition-colors", active ? "font-medium text-ink bg-wash" : "text-muted hover:text-ink")}
                >
                  {l.label}
                </Link>
              );
            })}
          </nav>
        ) : null}
      </div>
    </header>
  );
}
