/**
 * Import from a link: a Google Sheet, or any CSV / Excel file reachable over
 * https. This is how "connected" sources stay current — the link is saved with
 * the file so it can be refreshed with one click.
 *
 * Because the server fetches a URL the user supplies, the request is locked
 * down: https only, public addresses only, capped size, short timeout.
 */
import dns from "node:dns/promises";
import net from "node:net";

export const MAX_IMPORT_BYTES = 25 * 1024 * 1024;

export interface LinkTarget { url: string; fileName: string; source: "google_sheets" | "file" }

/** Turn what the owner pasted into a direct download URL. Throws a plain-English error when it can't be used. */
export function normalizeImportUrl(raw: string): LinkTarget {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new Error("That doesn't look like a link. Paste the full address, starting with https://");
  }
  if (u.protocol !== "https:") throw new Error("Only https:// links can be imported.");
  const sheet = u.hostname === "docs.google.com" ? u.pathname.match(/^\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/) : null;
  if (sheet) {
    // The whole workbook, every tab, as Excel. Works when the sheet is shared as "Anyone with the link can view".
    return { url: `https://docs.google.com/spreadsheets/d/${sheet[1]}/export?format=xlsx`, fileName: `google-sheet-${sheet[1].slice(0, 8)}.xlsx`, source: "google_sheets" };
  }
  const name = decodeURIComponent(u.pathname.split("/").pop() || "");
  if (!/\.(csv|xlsx|xls|tsv)$/i.test(name)) {
    throw new Error("The link needs to point to a Google Sheet, or to a file ending in .csv, .xlsx or .xls.");
  }
  return { url: u.toString(), fileName: name.replace(/[^\w.\-]+/g, "_"), source: "file" };
}

/** Private, loopback, link-local and other non-public addresses. */
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return isPrivateAddress(v.slice(7));
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("ff");
}

async function assertPublicHost(rawHost: string): Promise<void> {
  const hostname = rawHost.replace(/^\[|\]$/g, ""); // IPv6 literals arrive in brackets
  if (net.isIP(hostname) ? isPrivateAddress(hostname) : false) throw new Error("That address isn't reachable from here.");
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(hostname)) throw new Error("That address isn't reachable from here.");
  if (!net.isIP(hostname)) {
    const addrs = await dns.lookup(hostname, { all: true }).catch(() => []);
    if (!addrs.length) throw new Error("Tally couldn't find that website.");
    if (addrs.some((a) => isPrivateAddress(a.address))) throw new Error("That address isn't reachable from here.");
  }
}

/** Download the linked file. Redirects are followed by hand so every hop is checked. */
export async function fetchLinkedFile(target: LinkTarget): Promise<Buffer> {
  let url = target.url;
  for (let hop = 0; hop < 5; hop++) {
    const u = new URL(url);
    if (u.protocol !== "https:") throw new Error("Only https:// links can be imported.");
    await assertPublicHost(u.hostname);
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(20_000), headers: { "User-Agent": "tally-import" } });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = new URL(res.headers.get("location")!, url).toString();
      continue;
    }
    if (res.status === 401 || res.status === 403 || /accounts\.google\.com|ServiceLogin/.test(res.url)) {
      throw new Error(target.source === "google_sheets"
        ? 'Google wouldn\'t share that sheet. In Google Sheets choose Share → General access → "Anyone with the link" (Viewer), then try again.'
        : "That link needs a sign-in, so Tally can't read it.");
    }
    if (!res.ok) throw new Error(`The link returned an error (${res.status}).`);
    const type = res.headers.get("content-type") ?? "";
    if (/text\/html/.test(type)) {
      throw new Error(target.source === "google_sheets"
        ? 'Google returned a sign-in page instead of the sheet. Set sharing to "Anyone with the link" (Viewer) and try again.'
        : "That link opens a web page, not a file.");
    }
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > MAX_IMPORT_BYTES) throw new Error("That file is larger than 25 MB.");
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_IMPORT_BYTES) throw new Error("That file is larger than 25 MB.");
    return buf;
  }
  throw new Error("That link redirects too many times.");
}
