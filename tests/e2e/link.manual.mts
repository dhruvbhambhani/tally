/**
 * Manual network check (not part of `npm test`):
 *   npx tsx tests/e2e/link.manual.mts <https link to a CSV/XLSX or Google Sheet>
 * Downloads the link the same way the app does and reports what Tally makes of it.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "../../src/lib/db/client";
import { properties } from "../../src/lib/db/schema";
import { fetchLinkedFile, normalizeImportUrl } from "../../src/lib/ingest/link";
import { ingestFile } from "../../src/lib/ingest/stage";

const link = process.argv[2];
if (!link) throw new Error("Pass a link");
process.env.TALLY_AI_PROVIDER = "demo";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tally-link-"));
const db = openDb(path.join(dir, "t.db"));
db.insert(properties).values({ id: "p", name: "P" }).run();
const target = normalizeImportUrl(link);
const buf = await fetchLinkedFile(target);
console.log("downloaded", buf.length, "bytes as", target.fileName);
console.log(await ingestFile(db, "p", target.fileName, buf, { link }));
