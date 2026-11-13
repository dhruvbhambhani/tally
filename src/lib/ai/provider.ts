/**
 * The single AI seam. AI is used ONLY to (1) read messy sources, (2) help match
 * ambiguous records / route a question to a query function, and (3) write words.
 * It never computes or supplies a figure: numbers come from the deterministic
 * functions in /lib/metrics, /lib/recs and /lib/delinquency.
 */
import { DemoProvider } from "./demo";
import { OpenAICompatibleProvider } from "./openai";
import { aiKey } from "../session";

export interface Cell<T = string | number | null> {
  value: T;
  raw?: string;
  /** 0–1. Below the review threshold the value goes to the review queue. */
  confidence: number;
}

/** Fractions of the image (0–1), so crops work at any resolution. */
export interface Region { x: number; y: number; w: number; h: number }

export interface LedgerRow {
  region: Region;
  cells: { date: Cell<string | null>; unit: Cell<string | null>; name: Cell<string | null>; amount: Cell<number | null>; note: Cell<string | null> };
}

export const LEASE_FIELDS = [
  "unit", "residents", "start", "end", "rent", "deposit", "petFee", "parkingFee", "lateFeeAmount", "lateFeeAfterDay",
  "mtmPremium", "concessionAmount", "concessionEnds", "tenantPortion", "hapPortion", "renewalTerms",
] as const;
export type LeaseField = (typeof LEASE_FIELDS)[number];
export type LeaseAbstract = Record<LeaseField, Cell>;

export type ExtractRequest =
  | { task: "ledger_image"; image: Buffer; mime: string; fileName: string; sha256: string }
  | { task: "lease"; text: string; fileName: string }
  | { task: "ask_intent"; question: string; tools: { name: string; description: string; params: string }[] };

export type ExtractResult =
  | { task: "ledger_image"; rows: LedgerRow[]; note?: string }
  | { task: "lease"; fields: LeaseAbstract; note?: string }
  | { task: "ask_intent"; tool: string | null; args: Record<string, string | number> };

export interface GenerateRequest {
  /** what is being written, e.g. "friendly_reminder" */
  task: string;
  language: "en" | "es";
  /** computed facts the text may use — the only figures allowed in the output */
  facts: Record<string, string | number>;
  /** deterministic template text; returned as-is by the demo provider and used whenever the model's output fails verification */
  fallback: string;
  instructions?: string;
}

export interface AIProvider {
  name: string;
  /** true when no model is called */
  demo: boolean;
  extract<R extends ExtractRequest>(req: R): Promise<Extract<ExtractResult, { task: R["task"] }>>;
  generate(req: GenerateRequest): Promise<string>;
}

export const DEFAULT_MODELS = { openai: "gpt-4o", xai: "grok-4" } as const;
export const BASE_URLS = { openai: "https://api.openai.com/v1", xai: "https://api.x.ai/v1" } as const;

/**
 * Which provider handles this request:
 *  1. the visitor's own key (entered in Settings, held in an httpOnly cookie)
 *  2. a server-wide key from the environment (self-hosted installs)
 *  3. the demo provider — no model is called
 */
export async function getProvider(): Promise<AIProvider> {
  if (process.env.TALLY_AI_PROVIDER === "demo") return new DemoProvider();
  const own = await aiKey();
  if (own) {
    return new OpenAICompatibleProvider({
      name: own.provider, apiKey: own.apiKey,
      baseUrl: (own.provider === "openai" ? process.env.OPENAI_BASE_URL : process.env.XAI_BASE_URL) ?? BASE_URLS[own.provider],
      model: own.model || DEFAULT_MODELS[own.provider],
    });
  }
  if (process.env.OPENAI_API_KEY) {
    return new OpenAICompatibleProvider({
      name: "openai", apiKey: process.env.OPENAI_API_KEY,
      baseUrl: process.env.OPENAI_BASE_URL ?? BASE_URLS.openai, model: process.env.TALLY_AI_MODEL ?? DEFAULT_MODELS.openai,
    });
  }
  if (process.env.XAI_API_KEY) {
    return new OpenAICompatibleProvider({
      name: "xai", apiKey: process.env.XAI_API_KEY,
      baseUrl: process.env.XAI_BASE_URL ?? BASE_URLS.xai, model: process.env.TALLY_AI_MODEL ?? DEFAULT_MODELS.xai,
    });
  }
  return new DemoProvider();
}

/**
 * Guard for generated text: every dollar figure in `text` must be one of the
 * computed facts. If the model invents or alters a number, we discard its text.
 */
export function figuresAreGrounded(text: string, facts: Record<string, string | number>): boolean {
  const allowed = new Set<string>();
  for (const v of Object.values(facts)) {
    for (const m of String(v).matchAll(/\$\s?([\d,]+(?:\.\d{1,2})?)/g)) allowed.add(normalizeFigure(m[1]));
  }
  for (const m of text.matchAll(/\$\s?([\d,]+(?:\.\d{1,2})?)/g)) {
    if (!allowed.has(normalizeFigure(m[1]))) return false;
  }
  return true;
}

function normalizeFigure(s: string): string {
  return String(Math.round(parseFloat(s.replace(/,/g, "")) * 100));
}
