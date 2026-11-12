import fs from "node:fs";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { sourceFiles } from "@/lib/db/schema";

const TYPES: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf", csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/** Serves an uploaded source file (used for the image crops in the review queue). */
export async function GET(_req: Request, ctx: RouteContext<"/api/files/[id]">) {
  const { id } = await ctx.params;
  const file = getDb().select().from(sourceFiles).where(eq(sourceFiles.id, id)).get();
  if (!file || !fs.existsSync(file.path)) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(fs.readFileSync(file.path)), {
    headers: { "Content-Type": TYPES[file.mime] ?? "application/octet-stream", "Cache-Control": "private, max-age=3600" },
  });
}
