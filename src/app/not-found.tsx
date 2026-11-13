import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-[720px] px-6 py-28 lg:px-10">
      <p className="text-sm text-muted">Not found</p>
      <h1 className="mt-2 text-5xl font-semibold tracking-tight">That page isn&apos;t here.</h1>
      <p className="mt-4 text-muted">The property may have been deleted, or the link is out of date.</p>
      <Button asChild variant="primary" size="lg" className="mt-8"><Link href="/">Go to the start</Link></Button>
    </div>
  );
}
