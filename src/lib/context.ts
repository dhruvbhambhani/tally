import { cache } from "react";
import { analyze, type Analysis } from "./analysis";
import { listProperties, loadProperty, primaryProperty, type PropertyData, type PropertyRow } from "./data/load";
import { ensureDemoSeed } from "./data/sample";
import { getDb, type DB } from "./db/client";
import { activePropertyId } from "./session";

export interface Ctx { db: DB; data: PropertyData; a: Analysis }

/** This request's database, seeded with the sample on a shared host. */
export const getReadyDb = cache(async (): Promise<DB> => {
  const db = await getDb();
  await ensureDemoSeed(db);
  return db;
});

/** Every property in the workspace and the one currently selected (it may not have a rent roll yet). */
export const getProperties = cache(async (): Promise<{ db: DB; all: PropertyRow[]; current: PropertyRow | null }> => {
  const db = await getReadyDb();
  const all = listProperties(db);
  return { db, all, current: primaryProperty(db, await activePropertyId()) };
});

/** The selected property's built rent roll and every metric for it — computed once per request. */
export const getContext = cache(async (): Promise<Ctx | null> => {
  const { db, current } = await getProperties();
  if (!current) return null;
  const data = loadProperty(db, current.id);
  if (!data) return null;
  return { db, data, a: analyze(data) };
});
