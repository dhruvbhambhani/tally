/**
 * Per-request context that comes from cookies:
 *  - workspace: on a shared host every browser gets its own private database
 *  - AI key:    a visitor's own API key, kept in an httpOnly cookie (never in the database, never sent back to the page)
 *  - property:  which property the screens are showing
 *
 * Outside a request (tests, scripts) everything falls back to defaults.
 */
import { cookies } from "next/headers";

export const WORKSPACE_COOKIE = "tally_ws";
export const AI_COOKIE = "tally_ai";
export const PROPERTY_COOKIE = "tally_property";

/**
 * Shared-host mode: each browser gets an isolated workspace and the sample
 * property is loaded for it. On by default on Vercel; set TALLY_SHARED=1 to
 * turn it on elsewhere. A self-hosted install has ONE workspace, on disk.
 */
export const SHARED_HOST = process.env.TALLY_SHARED === "1" || (!!process.env.VERCEL && process.env.TALLY_SHARED !== "0");

async function read(name: string): Promise<string | null> {
  try {
    return (await cookies()).get(name)?.value ?? null;
  } catch {
    return null; // not in a request
  }
}

export async function workspaceId(): Promise<string> {
  if (!SHARED_HOST) return "default";
  const v = await read(WORKSPACE_COOKIE);
  return v && /^[a-f0-9-]{16,64}$/.test(v) ? v : "anonymous";
}

export type AIProviderName = "openai" | "xai";
export interface AIKey { provider: AIProviderName; apiKey: string; model?: string }

export async function aiKey(): Promise<AIKey | null> {
  const raw = await read(AI_COOKIE);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as AIKey;
    return (v.provider === "openai" || v.provider === "xai") && typeof v.apiKey === "string" && v.apiKey.length > 8 ? v : null;
  } catch {
    return null;
  }
}

export async function activePropertyId(): Promise<string | null> {
  return read(PROPERTY_COOKIE);
}

const YEAR = 60 * 60 * 24 * 365;
export const cookieOptions = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: YEAR };
