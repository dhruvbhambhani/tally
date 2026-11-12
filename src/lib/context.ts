import { cache } from "react";
import { analyze, type Analysis } from "./analysis";
import { loadProperty, primaryProperty, type PropertyData } from "./data/load";
import { ensureDemoSeed } from "./data/sample";
import { getDb, type DB } from "./db/client";

export interface Ctx { db: DB; data: PropertyData; a: Analysis }

/** The built property and every metric for it — computed once per request. */
export const getContext = cache(async (): Promise<Ctx | null> => {
  await ensureDemoSeed();
  const db = getDb();
  const property = primaryProperty(db);
  if (!property) return null;
  const data = loadProperty(db, property.id);
  if (!data) return null;
  return { db, data, a: analyze(data) };
});
