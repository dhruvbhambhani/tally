"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { ArrowUp, Loader2 } from "lucide-react";
import { askQuestion } from "@/app/actions";
import { Button } from "@/components/ui/button";

interface Msg { role: "you" | "tally"; text: string; citations?: { label: string; href: string }[] }

export function Chat({ suggestions }: { suggestions: string[] }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [busy, start] = useTransition();
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [messages, busy]);

  const send = (question: string) => {
    const text = question.trim();
    if (!text || busy) return;
    setQ("");
    setMessages((m) => [...m, { role: "you", text }]);
    start(async () => {
      try {
        const a = await askQuestion(text);
        setMessages((m) => [...m, { role: "tally", text: a.text, citations: a.citations }]);
      } catch {
        setMessages((m) => [...m, { role: "tally", text: "Something went wrong reaching Tally. Nothing was guessed — please try again." }]);
      }
    });
  };

  return (
    <div className="mt-10">
      <div className="space-y-6" aria-live="polite">
        {messages.map((m, i) => (
          <div key={i} className={m.role === "you" ? "flex justify-end" : ""}>
            {m.role === "you" ? (
              <p className="fade-in max-w-[80%] rounded-2xl bg-wash px-4 py-2.5">{m.text}</p>
            ) : (
              <div className="rise max-w-[92%]">
                <p className="whitespace-pre-line leading-relaxed">{m.text}</p>
                {m.citations?.length ? (
                  <p className="mt-3 flex flex-wrap gap-2 text-[13px]">
                    <span className="py-1 text-muted">From your data:</span>
                    {m.citations.map((c) => <Link key={c.href} href={c.href} className="rounded-full border border-line px-3 py-1 font-medium text-accent hover:bg-accent-soft">{c.label}</Link>)}
                  </p>
                ) : null}
              </div>
            )}
          </div>
        ))}
        {busy ? <p className="flex items-center gap-2 text-sm text-muted"><Loader2 className="size-4 animate-spin" /> Looking through your data…</p> : null}
        <div ref={end} />
      </div>

      {!messages.length ? (
        <div className="flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <button key={s} type="button" onClick={() => send(s)} className="cursor-pointer rounded-full border border-line px-4 py-2 text-sm transition-colors hover:border-accent hover:bg-accent-soft">{s}</button>
          ))}
        </div>
      ) : null}

      <form className="sticky bottom-4 mt-8 flex items-center gap-2 rounded-2xl border border-line bg-white p-2 shadow-sm focus-within:border-accent"
        onSubmit={(e) => { e.preventDefault(); send(q); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Who's paid late 3+ times this year?" aria-label="Your question"
          className="h-11 flex-1 bg-transparent px-3 text-base outline-none placeholder:text-muted/70" />
        <Button type="submit" variant="primary" disabled={busy || !q.trim()} aria-label="Ask" className="size-11 rounded-xl px-0"><ArrowUp /></Button>
      </form>
    </div>
  );
}
