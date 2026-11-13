import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import fs from "node:fs";
import path from "node:path";
import { workspaceId } from "../session";
import * as schema from "./schema";

export type DB = BetterSQLite3Database<typeof schema>;

/** Root folder for databases and uploads. Serverless hosts only allow writes under /tmp. */
export function dataRoot(): string {
  return process.env.TALLY_DATA_DIR ?? (process.env.VERCEL ? "/tmp/tally-data" : path.join(process.cwd(), "data"));
}

const dirs = new WeakMap<DB, string>();

/** The folder a database lives in — its uploads go in `<dir>/uploads`. */
export function dataDirOf(db: DB): string {
  const dir = dirs.get(db) ?? dataRoot();
  fs.mkdirSync(path.join(dir, "uploads"), { recursive: true });
  return dir;
}

export function openDb(file: string): DB {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  dirs.set(db, path.dirname(file));
  return db;
}

const g = globalThis as unknown as { __tallyDbs?: Map<string, DB> };

/**
 * The database for this request's workspace. A self-hosted install has one
 * ("default", at <data>/tally.db). On a shared host each browser has its own.
 */
export async function getDb(): Promise<DB> {
  const ws = await workspaceId();
  const cache = (g.__tallyDbs ??= new Map());
  let db = cache.get(ws);
  if (!db) {
    const file = ws === "default" ? (process.env.TALLY_DB_PATH ?? path.join(dataRoot(), "tally.db")) : path.join(dataRoot(), "workspaces", ws, "tally.db");
    db = openDb(file);
    cache.set(ws, db);
  }
  return db;
}

/** Delete every row and uploaded file in a workspace. */
export function wipeDb(db: DB): void {
  for (const t of [schema.properties, schema.sourceFiles, schema.stagedRows, schema.columnMappings, schema.units, schema.leases, schema.charges,
    schema.payments, schema.notices, schema.conflicts, schema.resolutions, schema.fieldProvenance, schema.promises, schema.comps]) {
    db.delete(t).run();
  }
  const uploads = path.join(dataDirOf(db), "uploads");
  for (const f of fs.readdirSync(uploads)) fs.rmSync(path.join(uploads, f), { force: true });
}

export { schema };
