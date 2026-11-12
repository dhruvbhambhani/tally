import { redirect } from "next/navigation";
import { SUGGESTED_QUESTIONS } from "@/lib/ask/tools";
import { getContext } from "@/lib/context";
import { Chat } from "./chat";

export const dynamic = "force-dynamic";

export default async function AskPage() {
  const ctx = await getContext();
  if (!ctx) redirect("/");
  return (
    <div className="mx-auto flex max-w-[860px] flex-col px-6 py-14 lg:px-10">
      <p className="text-sm text-muted">Ask Tally · {ctx.data.property.name}</p>
      <h1 className="mt-2 text-5xl font-semibold tracking-tight sm:text-6xl">Ask about your property.</h1>
      <p className="mt-4 max-w-[60ch] text-muted">
        Answers come only from your own rent roll, leases and payments, using the same calculations as the rest of Tally. If your data can&apos;t answer it, Tally says so.
      </p>
      <Chat suggestions={SUGGESTED_QUESTIONS} />
    </div>
  );
}
