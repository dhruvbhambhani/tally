"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, Loader2 } from "lucide-react";
import { clearAiKey, deleteAllData, saveAiKey, switchProperty } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const input = "h-10 rounded-lg border border-line bg-white px-3 text-sm";
const NAMES = { openai: "OpenAI", xai: "xAI" } as const;

export function AiKeyForm({ current, serverKey }: { current: { provider: "openai" | "xai"; last4: string; model: string } | null; serverKey: string | null }) {
  const router = useRouter();
  const [provider, setProvider] = useState<"openai" | "xai">(current?.provider ?? "openai");
  const [key, setKey] = useState("");
  const [model, setModel] = useState(current?.model ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, start] = useTransition();

  return (
    <div>
      {current ? (
        <p className="mb-4 flex flex-wrap items-center gap-3 text-sm">
          <Check className="size-4 text-accent" aria-hidden />
          <span>Using your {NAMES[current.provider]} key ending in <span className="num font-medium">{current.last4}</span>{current.model ? ` · ${current.model}` : ""}</span>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => start(async () => { await clearAiKey(); setMsg({ ok: true, text: "Key removed from this browser." }); router.refresh(); })}>Remove key</Button>
        </p>
      ) : serverKey ? (
        <p className="mb-4 text-sm text-muted">This install already has a {serverKey === "xai" ? "xAI" : "OpenAI"} key set on the server. Add your own below to use it instead.</p>
      ) : (
        <p className="mb-4 text-sm text-muted">No key yet. Tally is reading files with built-in rules and writing letters from templates.</p>
      )}
      <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveAiKey(provider, key, model);
          setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: r.ok ?? "Saved." });
          if (!r.error) { setKey(""); router.refresh(); }
        });
      }}>
        <label className="flex flex-col gap-1.5 text-[13px] text-muted">Provider
          <select value={provider} onChange={(e) => setProvider(e.target.value as "openai" | "xai")} className={cn(input, "text-ink")}>
            <option value="openai">OpenAI</option>
            <option value="xai">xAI</option>
          </select>
        </label>
        <label className="flex min-w-[260px] flex-1 flex-col gap-1.5 text-[13px] text-muted">API key
          <input type="password" autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)}
            placeholder={provider === "openai" ? "sk-…" : "xai-…"} className={cn(input, "w-full text-ink")} />
        </label>
        <label className="flex flex-col gap-1.5 text-[13px] text-muted">Model (optional)
          <input value={model} onChange={(e) => setModel(e.target.value)} placeholder={provider === "openai" ? "gpt-4o" : "grok-4"} className={cn(input, "w-[150px] text-ink")} />
        </label>
        <Button type="submit" disabled={busy || key.trim().length < 20}>{busy ? <Loader2 className="animate-spin" /> : null} Check and save</Button>
      </form>
      {msg ? <p className={cn("mt-3 text-sm", msg.ok ? "text-accent" : "text-danger")} role={msg.ok ? "status" : "alert"}>{msg.text}</p> : null}
    </div>
  );
}

export function PropertySwitch({ id }: { id: string }) {
  const [busy, start] = useTransition();
  return <Button size="sm" disabled={busy} onClick={() => start(() => switchProperty(id))}>Show this one</Button>;
}

export function EraseEverything() {
  const [confirming, setConfirming] = useState(false);
  const [busy, start] = useTransition();
  return (
    <div className="mt-5">
      {confirming ? (
        <div className="fade-in rounded-xl border border-line p-4">
          <p className="text-ink">Erase every property, file, letter and setting? This can&apos;t be undone.</p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" disabled={busy} className="border-danger text-danger hover:bg-danger-soft" onClick={() => start(() => deleteAllData())}>
              {busy ? <Loader2 className="animate-spin" /> : null} Yes, erase everything
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <Button size="sm" onClick={() => setConfirming(true)}>Erase everything…</Button>
      )}
    </div>
  );
}

/** Property picker shown in the header when there is more than one property. */
export function PropertyPicker({ properties, current }: { properties: { id: string; name: string }[]; current: string }) {
  const [busy, start] = useTransition();
  return (
    <select aria-label="Property" value={current} disabled={busy} onChange={(e) => start(() => switchProperty(e.target.value))}
      className="h-9 max-w-[200px] rounded-lg border border-line bg-white px-2 text-sm">
      {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
  );
}
