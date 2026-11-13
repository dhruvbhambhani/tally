/** Loads the bundled Maple Court sample files through the real import pipeline. */
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { dataDirOf, type DB } from "../db/client";
import { properties } from "../db/schema";
import { ingestFile, type IngestResult } from "../ingest/stage";
import { buildRentRoll, type BuildSummary } from "../reconcile/build";
import { SHARED_HOST } from "../session";

export const SAMPLE_PROPERTY_ID = "maple-court";
export const SAMPLE_DIR = path.join(process.cwd(), "sample-data", "maple-court");

export function ensureProperty(db: DB, id: string, name: string): void {
  const existing = db.select().from(properties).where(eq(properties.id, id)).get();
  if (!existing) db.insert(properties).values({ id, name }).run();
}

export function sampleFiles(): string[] {
  return fs.readdirSync(SAMPLE_DIR).filter((f) => !f.startsWith(".")).sort();
}

export async function importSampleData(db: DB): Promise<{ files: IngestResult[]; build: BuildSummary }> {
  ensureProperty(db, SAMPLE_PROPERTY_ID, "Maple Court");
  const files: IngestResult[] = [];
  for (const name of sampleFiles()) {
    files.push(await ingestFile(db, SAMPLE_PROPERTY_ID, name, fs.readFileSync(path.join(SAMPLE_DIR, name))));
  }
  return { files, build: buildRentRoll(db, SAMPLE_PROPERTY_ID) };
}

const seeding = new WeakMap<DB, Promise<unknown>>();

/**
 * Shared host (the public demo): a new visitor's workspace starts with the
 * sample property so there is something to look at. It is seeded once — if the
 * visitor deletes it to try their own files, it stays deleted. A self-hosted
 * install is never seeded automatically.
 */
export async function ensureDemoSeed(db: DB): Promise<void> {
  if (!SHARED_HOST && process.env.TALLY_DEMO_SEED !== "1") return;
  const marker = path.join(dataDirOf(db), ".seeded");
  if (fs.existsSync(marker)) return;
  if (!seeding.has(db)) {
    seeding.set(db, (async () => {
      if (!db.select().from(properties).all().length) await importSampleData(db);
      fs.writeFileSync(marker, new Date().toISOString());
    })().catch((e) => { seeding.delete(db); throw e; }));
  }
  await seeding.get(db);
}
