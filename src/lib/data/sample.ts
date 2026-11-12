/** Loads the bundled Maple Court sample files through the real import pipeline. */
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getDb, type DB } from "../db/client";
import { properties } from "../db/schema";
import { ingestFile, type IngestResult } from "../ingest/stage";
import { buildRentRoll, type BuildSummary } from "../reconcile/build";

export const SAMPLE_PROPERTY_ID = "maple-court";
export const SAMPLE_DIR = path.join(process.cwd(), "sample-data", "maple-court");

export function ensureProperty(db: DB, id: string, name: string): void {
  const existing = db.select().from(properties).where(eq(properties.id, id)).get();
  if (!existing) db.insert(properties).values({ id, name }).run();
}

export function sampleFiles(): string[] {
  return fs.readdirSync(SAMPLE_DIR).filter((f) => !f.startsWith(".")).sort();
}

export async function importSampleData(db: DB = getDb()): Promise<{ files: IngestResult[]; build: BuildSummary }> {
  ensureProperty(db, SAMPLE_PROPERTY_ID, "Maple Court");
  const files: IngestResult[] = [];
  for (const name of sampleFiles()) {
    files.push(await ingestFile(db, SAMPLE_PROPERTY_ID, name, fs.readFileSync(path.join(SAMPLE_DIR, name))));
  }
  return { files, build: buildRentRoll(db, SAMPLE_PROPERTY_ID) };
}

const g = globalThis as unknown as { __tallySeed?: Promise<unknown> };

/**
 * Hosted demo: serverless instances start with an empty /tmp database, so seed
 * the sample property on first use. Locally nothing is seeded automatically.
 */
export async function ensureDemoSeed(): Promise<void> {
  if (!process.env.VERCEL && process.env.TALLY_DEMO_SEED !== "1") return;
  const db = getDb();
  if (db.select().from(properties).all().some((p) => p.unitCount > 0)) return;
  g.__tallySeed ??= importSampleData(db).catch((e) => {
    g.__tallySeed = undefined;
    throw e;
  });
  await g.__tallySeed;
}
