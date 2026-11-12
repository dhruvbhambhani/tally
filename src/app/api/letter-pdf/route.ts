import { letterPdf } from "@/lib/pdf/documents";

/** Turns approved letter text into a PDF. Nothing is sent anywhere. */
export async function POST(req: Request) {
  const { body, name } = (await req.json()) as { body?: string; name?: string };
  if (!body || body.length > 20_000) return new Response("Letter text required", { status: 400 });
  const pdf = await letterPdf(body);
  const file = (name ?? "letter").replace(/[^\w-]+/g, "-").toLowerCase();
  return new Response(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${file}.pdf"` } });
}
