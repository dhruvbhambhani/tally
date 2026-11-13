import { describe, expect, it } from "vitest";
import { fetchLinkedFile, isPrivateAddress, normalizeImportUrl } from "./link";

describe("import from a link", () => {
  it("turns a Google Sheets address into a whole-workbook download", () => {
    const t = normalizeImportUrl("https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit?gid=0#gid=0");
    expect(t).toMatchObject({ source: "google_sheets", url: "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/export?format=xlsx" });
    expect(t.fileName).toMatch(/\.xlsx$/);
  });
  it("accepts direct CSV and Excel links", () => {
    expect(normalizeImportUrl("https://example.com/exports/Rent%20Roll.csv")).toMatchObject({ source: "file", fileName: "Rent_Roll.csv" });
    expect(normalizeImportUrl("https://example.com/a/b/tracker.xlsx?dl=1").fileName).toBe("tracker.xlsx");
  });
  it("rejects anything that isn't an https file link, in plain English", () => {
    expect(() => normalizeImportUrl("not a link")).toThrow(/doesn't look like a link/);
    expect(() => normalizeImportUrl("http://example.com/a.csv")).toThrow(/Only https/);
    expect(() => normalizeImportUrl("file:///etc/passwd")).toThrow(/Only https/);
    expect(() => normalizeImportUrl("https://example.com/dashboard")).toThrow(/Google Sheet, or to a file/);
  });
  it("recognizes private and loopback addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "172.32.0.1", "142.250.72.14", "2607:f8b0:4005:80a::200e"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });
  it("refuses to fetch internal addresses (no server-side request forgery)", async () => {
    for (const url of ["https://127.0.0.1/a.csv", "https://localhost/a.csv", "https://169.254.169.254/latest/meta-data/x.csv", "https://[::1]/a.csv", "https://printer.local/a.csv"]) {
      await expect(fetchLinkedFile({ url, fileName: "a.csv", source: "file" }), url).rejects.toThrow(/isn't reachable|couldn't find/);
    }
  });
});
