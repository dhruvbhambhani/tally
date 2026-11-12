import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";

export type DB = BetterSQLite3Database<typeof schema>;

/** Where the database and uploads live. Serverless hosts only allow writes under /tmp. */
export function dataDir(): string {
  const dir = process.env.TALLY_DATA_DIR ?? (process.env.VERCEL ? "/tmp/tally-data" : path.join(process.cwd(), "data"));
  fs.mkdirSync(path.join(dir, "uploads"), { recursive: true });
  return dir;
}

export function openDb(file: string): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  return db;
}

const g = globalThis as unknown as { __tallyDb?: DB };

export function getDb(): DB {
  if (!g.__tallyDb) {
    g.__tallyDb = openDb(process.env.TALLY_DB_PATH ?? path.join(dataDir(), "tally.db"));
  }
  return g.__tallyDb;
}

export { schema };
