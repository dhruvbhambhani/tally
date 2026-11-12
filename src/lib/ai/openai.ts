/**
 * Real provider for any OpenAI-compatible chat API (OpenAI, xAI).
 * Enabled by OPENAI_API_KEY or XAI_API_KEY. Uses plain fetch — no SDK.
 */
import {
  LEASE_FIELDS, figuresAreGrounded, type AIProvider, type ExtractRequest, type ExtractResult, type GenerateRequest,
  type LeaseAbstract, type LedgerRow,
} from "./provider";
import { parseDate } from "../dates";

interface Options { name: string; apiKey: string; baseUrl: string; model: string }

export class OpenAICompatibleProvider implements AIProvider {
  name: string;
  demo = false;
  constructor(private opts: Options) {
    this.name = opts.name;
  }

  private async chat(messages: unknown[], json: boolean): Promise<string> {
    const res = await fetch(`${this.opts.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.opts.apiKey}` },
      body: JSON.stringify({
        model: this.opts.model, messages, temperature: 0,
        ...(json ? { response_format: { type: "json_object" } } : {}),
      }),
    });
    if (!res.ok) throw new Error(`AI provider error ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as { choices: { message: { content: string } }[] };
    return data.choices[0]?.message?.content ?? "";
  }

  async extract<R extends ExtractRequest>(req: R): Promise<Extract<ExtractResult, { task: R["task"] }>> {
    type Out = Extract<ExtractResult, { task: R["task"] }>;
    if (req.task === "ledger_image") {
      const prompt =
        "This is a photo or scan of a landlord's handwritten rent ledger or receipt book. Transcribe every payment line. " +
        'Return JSON: {"rows":[{"region":{"x":0-1,"y":0-1,"w":0-1,"h":0-1},"cells":{"date":{"value":"YYYY-MM-DD or null","raw":"as written","confidence":0-1},' +
        '"unit":{...},"name":{...},"amount":{"value":number_in_dollars_or_null,"raw":"as written","confidence":0-1},"note":{...}}}]}. ' +
        "region is the bounding box of the line as fractions of the image. confidence is how sure you are of each cell; " +
        "use a low confidence for any character that could be read two ways. Never guess a value you cannot read — use null. Do not add, total or correct amounts.";
      const out = await this.chat(
        [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: `data:${req.mime};base64,${req.image.toString("base64")}` } }] }],
        true,
      );
      const parsed = JSON.parse(out) as { rows: LedgerRow[] };
      for (const r of parsed.rows ?? []) {
        if (typeof r.cells.amount?.value === "number") r.cells.amount.value = Math.round(r.cells.amount.value * 100);
        if (r.cells.date?.value) r.cells.date.value = parseDate(r.cells.date.value);
      }
      return { task: "ledger_image", rows: parsed.rows ?? [] } as Out;
    }
    if (req.task === "lease") {
      const prompt =
        "Abstract this residential lease. Return JSON with exactly these keys: " + LEASE_FIELDS.join(", ") + ". " +
        'Each key maps to {"value": ..., "raw": "the exact sentence it came from", "confidence": 0-1}. ' +
        "Dates as YYYY-MM-DD. Money as a number of dollars exactly as written in the lease (do not compute anything). " +
        "residents is a semicolon-separated list. Use null with confidence 0 for anything the lease does not state.\n\nLEASE TEXT:\n" + req.text.slice(0, 60_000);
      const parsed = JSON.parse(await this.chat([{ role: "user", content: prompt }], true)) as LeaseAbstract;
      const moneyKeys = ["rent", "deposit", "petFee", "parkingFee", "lateFeeAmount", "mtmPremium", "concessionAmount", "tenantPortion", "hapPortion"] as const;
      for (const k of LEASE_FIELDS) parsed[k] ??= { value: null, confidence: 0 };
      for (const k of moneyKeys) {
        const c = parsed[k];
        if (typeof c.value === "number") c.value = Math.round(c.value * 100);
      }
      return { task: "lease", fields: parsed } as Out;
    }
    const prompt =
      "You route an apartment owner's question to ONE query function. You never answer from your own knowledge and never produce numbers.\n" +
      "Functions:\n" + req.tools.map((t) => `- ${t.name}(${t.params}): ${t.description}`).join("\n") +
      '\nReturn JSON {"tool": "<name or null>", "args": {...}}. Use null when no function can answer the question.\n\nQuestion: ' + req.question;
    const parsed = JSON.parse(await this.chat([{ role: "user", content: prompt }], true)) as { tool: string | null; args?: Record<string, string | number> };
    const tool = parsed.tool && req.tools.some((t) => t.name === parsed.tool) ? parsed.tool : null;
    return { task: "ask_intent", tool, args: parsed.args ?? {} } as Out;
  }

  async generate(req: GenerateRequest): Promise<string> {
    const prompt =
      `Write a ${req.task.replace(/_/g, " ")} in ${req.language === "es" ? "Spanish" : "English"} for a small apartment owner to send to a resident. ` +
      "Warm, plain, short. Use ONLY the facts below; copy every dollar amount and date exactly; do not add, total, estimate or invent any figure, fee, deadline or legal claim. " +
      "Do not threaten eviction or legal action.\n" +
      (req.instructions ? req.instructions + "\n" : "") +
      "FACTS:\n" + Object.entries(req.facts).map(([k, v]) => `- ${k}: ${v}`).join("\n") +
      "\n\nHere is an acceptable version to improve on (keep all of its figures):\n" + req.fallback;
    try {
      const text = (await this.chat([{ role: "user", content: prompt }], false)).trim();
      // The model writes words; if it changed or invented a number, use the template instead.
      const facts = { ...req.facts, __fallback: req.fallback };
      return text && figuresAreGrounded(text, facts) ? text : req.fallback;
    } catch {
      return req.fallback;
    }
  }
}
