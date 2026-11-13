"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-[720px] px-6 py-28 lg:px-10">
      <p className="text-sm text-muted">Something went wrong</p>
      <h1 className="mt-2 text-5xl font-semibold tracking-tight">Tally hit a problem.</h1>
      <p className="mt-4 text-muted">Your data hasn&apos;t been changed. Try again, and if it keeps happening, the reference below will help track it down.</p>
      {error.digest ? <p className="num mt-2 text-[13px] text-muted">Reference: {error.digest}</p> : null}
      <div className="mt-8 flex items-center gap-5">
        <Button variant="primary" size="lg" onClick={reset}>Try again</Button>
        <Link href="/" className="text-sm font-medium underline-offset-4 hover:underline">Go to the start</Link>
      </div>
    </div>
  );
}
