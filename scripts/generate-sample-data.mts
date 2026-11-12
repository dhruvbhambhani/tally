/**
 * Renders the Maple Court sample files from scripts/sample/truth.ts.
 *   npm run sample:generate
 * Output is committed under sample-data/maple-court so the demo works offline.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import sharp from "sharp";
import * as XLSX from "xlsx";
import {
  AS_OF, LATE_DAYS, LATE_FEES_CHARGED, LEASE_DOCS, LEDGER_MONTHS, NOV_LATE_DAY, NOV_NO_PAYMENT, NOV_PARTIAL,
  PROPERTY, SHORT_PAYS, SPLIT_PAYERS, UNITS, tenantMonthly, unit, usualDay, type TLease, type TUnit,
} from "./sample/truth";

const OUT = path.join(process.cwd(), "sample-data", "maple-court");
const FIXTURES = path.join(process.cwd(), "src", "lib", "ai", "fixtures");
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(FIXTURES, { recursive: true });

const us = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
};
const usShort = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${m}/${d}/${String(y).slice(2)}`;
};
const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const initial = (name: string) => {
  const [first, ...rest] = name.split(" ");
  return `${first[0]}. ${rest.join(" ")}`;
};

// ---------------------------------------------------------------- 1. PMS rent roll CSV
function rentRollCsv() {
  const header = [
    "Unit", "BD/BA", "Sq. Ft.", "Status", "Tenant", "Market Rent", "Rent", "Pet Rent", "Parking", "Storage",
    "Utility Bill-Back", "Concession", "Concession Ends", "Subsidy", "Deposit", "Lease From", "Lease To", "Move-in", "Vacant Since",
  ];
  const lines: string[][] = [
    ["Rent Roll"],
    [`${PROPERTY.name} - ${PROPERTY.address}, ${PROPERTY.city}, ${PROPERTY.state}`],
    [`As of: ${us(AS_OF)}`],
    [],
    header,
  ];
  const bdba = (u: TUnit) => (u.beds === 0 ? "Studio" : `${u.beds}/${u.baths}`);
  for (const u of UNITS) {
    const l = u.lease;
    if (!l) {
      lines.push([u.number, bdba(u), String(u.sqft), "Vacant-Unrented", "", money(u.market), "", "", "", "", "", "", "", "", "", "", "", "", us(u.vacantSince!)]);
      continue;
    }
    let leaseTo = us(l.end);
    // ERROR 1: impossible date for unit 110
    if (u.number === "110") leaseTo = "06/31/2027";
    const row = [
      u.number, bdba(u), String(u.sqft), u.status === "notice" ? "Notice-Unrented" : "Current", l.residents.join(", "),
      money(u.market), money(l.rent), l.pet ? money(l.pet) : "", l.parking ? money(l.parking) : "", l.storage ? money(l.storage) : "",
      l.utilities ? money(l.utilities) : "", l.concession ? money(l.concession.amount) : "", l.concession ? us(l.concession.endsOn) : "",
      l.subsidy ? money(l.subsidy.hap) : "", money(l.deposit), us(l.start), leaseTo, us(l.start), "",
    ];
    lines.push(row);
    // ERROR 2: unit 207 exported twice
    if (u.number === "207") lines.push([...row]);
  }
  // ERROR 3 lives in the data itself: unit 306 is billed $1,400 but its lease says $1,450.
  const totalRent = UNITS.reduce((t, u) => t + (u.lease?.rent ?? 0), 0);
  lines.push([]);
  lines.push(["Total", "", "", "", `${UNITS.filter((u) => u.lease).length} occupied`, money(UNITS.reduce((t, u) => t + u.market, 0)), money(totalRent)]);
  fs.writeFileSync(path.join(OUT, "appfolio_rent_roll_2026-11-10.csv"), lines.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n");
}

// ---------------------------------------------------------------- 2. Landlord tracker XLSX
interface LogRow { date: string; unit: string; amount: number; how: string; note: string }

function paymentLog(): LogRow[] {
  const rows: LogRow[] = [];
  LEDGER_MONTHS.forEach((period, mi) => {
    for (const u of UNITS) {
      const l = u.lease;
      if (!l || l.start > `${period}-28`) continue;
      const due = tenantMonthly(l, period);
      const short = SHORT_PAYS[u.number]?.[period];
      const lateDay = LATE_DAYS[u.number]?.[period];
      const day = short?.day ?? lateDay ?? usualDay(u.number, mi);
      let amount = short ? short.amount : due;
      const fee = LATE_FEES_CHARGED.find((f) => f.unit === u.number && f.date.startsWith(period) && f.paidWithRent);
      if (fee) amount += fee.amount;
      const date = `${period}-${String(day).padStart(2, "0")}`;
      const how = l.method === "cash" ? "cash" : l.method === "check" ? "check" : l.method === "ach" ? "ACH" : "Zelle";
      if (amount > 0) {
        rows.push({ date, unit: u.number, amount, how, note: fee ? "incl. $50 late fee" : short ? "partial" : "" });
      }
      if (l.subsidy) {
        rows.push({ date: `${period}-03`, unit: u.number, amount: l.subsidy.hap, how: "ACH", note: "HAP - housing authority" });
      }
    }
  });
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.unit.localeCompare(b.unit));
}

function trackerXlsx() {
  const tenants: (string | number)[][] = [["Apt", "Tenant", "Rent Amt", "Move In", "Lease Exp", "Dep", "Pet?", "Notes"]];
  for (const u of UNITS) {
    const l = u.lease;
    if (!l) {
      tenants.push([Number(u.number), "VACANT", "", "", "", "", "", `empty since ${usShort(u.vacantSince!)}`]);
      continue;
    }
    const names = l.sheetInitial ? l.residents.map(initial) : l.residents;
    tenants.push([
      Number(u.number), names.join(" / "), l.rent, usShort(l.start), l.mtm ? "MTM" : usShort(l.end), l.deposit,
      l.pet || u.number === "108" ? "Y" : "", l.notes ?? "",
    ]);
  }
  const log: (string | number)[][] = [["Date", "Apt", "Amount", "How", "Note"]];
  for (const r of paymentLog()) log.push([usShort(r.date), Number(r.unit), r.amount, r.how, r.note]);
  const fees: (string | number)[][] = [["Date", "Apt", "Late Fee"]];
  for (const f of LATE_FEES_CHARGED) fees.push([usShort(f.date), Number(f.unit), f.amount]);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(tenants), "Tenants");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(log), "Payments 2026");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(fees), "Late fees");
  fs.writeFileSync(path.join(OUT, "maple_ct_tracker.xlsx"), XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

// ---------------------------------------------------------------- 3. Bank statement CSV
function bankCsv() {
  type Txn = { date: string; desc: string; amount: number };
  const txns: Txn[] = [];
  const period = "2026-11";
  const bankName = (l: TLease, name: string) => (l.bankInitial ? `${name[0]} ${name.split(" ").slice(1).join(" ")}` : name).toUpperCase();
  for (const u of UNITS) {
    const l = u.lease;
    if (!l || NOV_NO_PAYMENT.includes(u.number) || l.method === "cash") continue;
    const day = NOV_LATE_DAY[u.number] ?? usualDay(u.number, 5);
    const date = `${period}-${String(day).padStart(2, "0")}`;
    const due = NOV_PARTIAL[u.number] ?? tenantMonthly(l, period);
    if (SPLIT_PAYERS.includes(u.number)) {
      const half = due / 2;
      txns.push({ date: `${period}-0${usualDay(u.number, 5)}`, desc: `ZELLE PAYMENT FROM ${l.residents[0].toUpperCase()} MEMO: RENT`, amount: half });
      txns.push({ date, desc: `ZELLE PAYMENT FROM ${l.residents[1].toUpperCase()} MEMO: MY HALF ${u.number}`, amount: half });
    } else if (l.method === "check") {
      txns.push({ date, desc: `MOBILE CHECK DEPOSIT MEMO: CK ${1000 + Number(u.number)} APT ${u.number}`, amount: due });
    } else if (l.method === "ach") {
      txns.push({ date, desc: `ACH CREDIT ${bankName(l, l.residents[0])} RENT`, amount: due });
    } else {
      const memo = NOV_PARTIAL[u.number] ? " MEMO: PARTIAL NOV" : Number(u.number) % 3 === 0 ? ` MEMO: NOV RENT ${u.number}` : "";
      txns.push({ date, desc: `ZELLE PAYMENT FROM ${bankName(l, l.residents[0])}${memo}`, amount: due });
    }
    if (l.subsidy) {
      txns.push({ date: `${period}-03`, desc: `ACH CREDIT TRAVIS CO HOUSING AUTH HAP MEMO: HAP UNIT ${u.number} NOV`, amount: l.subsidy.hap });
    }
  }
  // Two deposits Tally should NOT be able to match
  txns.push({ date: "2026-11-04", desc: "ZELLE PAYMENT FROM R MARSH", amount: 600 });
  txns.push({ date: "2026-11-06", desc: "MOBILE CHECK DEPOSIT", amount: 1425 });
  // Money going out (not deposits)
  txns.push({ date: "2026-11-01", desc: "ACH DEBIT LONE STAR MORTGAGE SVC", amount: -21840 });
  txns.push({ date: "2026-11-05", desc: "ACH DEBIT AUSTIN ENERGY", amount: -1312.44 });
  txns.push({ date: "2026-11-07", desc: "DEBIT CARD HOME DEPOT #6542", amount: -218.07 });

  txns.sort((a, b) => a.date.localeCompare(b.date));
  let bal = 18420.11;
  const lines = [["Posting Date", "Description", "Amount", "Type", "Balance"].join(",")];
  for (const t of txns) {
    bal += t.amount;
    lines.push([us(t.date), csvCell(t.desc), t.amount.toFixed(2), t.amount > 0 ? "CREDIT" : "DEBIT", bal.toFixed(2)].join(","));
  }
  fs.writeFileSync(path.join(OUT, "bank_statement_nov_2026.csv"), lines.join("\r\n") + "\r\n");
  return txns.filter((t) => t.amount > 0).length;
}

// ---------------------------------------------------------------- 4. Lease PDFs
const h = React.createElement;
const longDate = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

async function leasePdfs() {
  const s = StyleSheet.create({
    page: { padding: 56, fontSize: 10.5, fontFamily: "Times-Roman", lineHeight: 1.5 },
    title: { fontSize: 16, fontFamily: "Times-Bold", textAlign: "center", marginBottom: 4 },
    sub: { textAlign: "center", marginBottom: 18, color: "#444" },
    h: { fontFamily: "Times-Bold", marginTop: 10, marginBottom: 2 },
    p: { marginBottom: 4, textAlign: "justify" },
    sig: { marginTop: 36, flexDirection: "row", justifyContent: "space-between" },
    line: { borderTopWidth: 0.7, borderTopColor: "#000", width: 200, paddingTop: 3 },
  });
  for (const doc of LEASE_DOCS) {
    const u = unit(doc.unit);
    const l = u.lease!;
    const sections: [string, string][] = [
      ["1. PARTIES", `This Residential Lease Agreement is made between ${PROPERTY.owner} ("Landlord") and ${l.residents.join(" and ")} ("Resident").`],
      ["2. PREMISES", `Landlord leases to Resident Unit ${u.number}, ${PROPERTY.name}, ${PROPERTY.address}, ${PROPERTY.city}, ${PROPERTY.state} ${PROPERTY.zip} (${u.type}, approximately ${u.sqft} square feet).`],
      ["3. LEASE TERM", `Lease Term: Begins ${longDate(l.start)} and ends ${longDate(l.end)}.`],
      ["4. RENT", `Monthly Rent: $${money(doc.rent)}, due on the 1st day of each month.`],
      ["5. SECURITY DEPOSIT", `Security Deposit: $${money(doc.deposit)}, to be held by Landlord for the term of this Lease.`],
    ];
    let n = 6;
    if (doc.subsidy) sections.push([`${n++}. HOUSING ASSISTANCE`, `This Lease is subject to a Housing Assistance Payments contract. Tenant Portion: $${money(doc.subsidy.tenant)} per month. Housing Assistance Payment (HAP): $${money(doc.subsidy.hap)} per month, paid by the housing authority.`]);
    if (doc.petFee) sections.push([`${n++}. PETS`, `Resident may keep one approved pet. Pet Fee: $${money(doc.petFee)} per month, due with rent.`]);
    if (doc.concession) sections.push([`${n++}. RENT CONCESSION`, `Rent Concession: $${money(doc.concession.amount)} per month off Monthly Rent through ${longDate(doc.concession.endsOn)}, after which the full Monthly Rent is due.`]);
    if (doc.lateFee) sections.push([`${n++}. LATE CHARGES`, `Late Fee: If rent is not received by the ${doc.lateFee.afterDay}th day of the month, Resident agrees to pay a late fee of $${money(doc.lateFee.amount)}.`]);
    sections.push([
      `${n++}. RENEWAL; HOLDING OVER`,
      doc.mtmPremium
        ? `If Resident remains after the Lease Term without signing a renewal, the tenancy continues month-to-month. Month-to-Month Premium: $${money(doc.mtmPremium)} per month in addition to Monthly Rent. Either party may end a month-to-month tenancy with 30 days written notice.`
        : `If Resident remains after the Lease Term without signing a renewal, the tenancy continues month-to-month on the same terms. Either party may end a month-to-month tenancy with 30 days written notice.`,
    ]);
    sections.push([`${n++}. UTILITIES`, "Resident pays electricity and internet. Landlord pays water, sewer and trash unless billed back under a separate addendum."]);
    sections.push([`${n++}. ENTIRE AGREEMENT`, "This Lease is the entire agreement between the parties. SAMPLE DOCUMENT generated for the Tally demo. All names are fictional."]);

    const el = h(Document, null,
      h(Page, { size: "LETTER", style: s.page },
        h(Text, { style: s.title }, "RESIDENTIAL LEASE AGREEMENT"),
        h(Text, { style: s.sub }, `${PROPERTY.name} · Unit ${u.number}`),
        ...sections.flatMap(([head, body], i) => [h(Text, { key: `h${i}`, style: s.h }, head), h(Text, { key: `p${i}`, style: s.p }, body)]),
        h(View, { style: s.sig },
          h(Text, { style: s.line }, `Landlord: ${PROPERTY.owner}`),
          h(Text, { style: s.line }, `Resident: ${l.residents[0]}`),
        ),
      ),
    );
    fs.writeFileSync(path.join(OUT, `lease_unit_${u.number}.pdf`), await renderToBuffer(el));
  }
}

// ---------------------------------------------------------------- 5. "Scanned" handwritten ledgers
interface LedgerLine { date: string; unit: string; name: string; amount: string; note: string; conf?: Partial<Record<"date" | "unit" | "name" | "amount" | "note", number>>; value?: { amount?: number } }

async function ledgerImage(file: string, title: string, lines: LedgerLine[], seed: number, year: number) {
  const W = 1500, H = 1040;
  const cols = { date: 110, unit: 290, name: 440, amount: 880, note: 1090 };
  const top = 250, rowH = 86;
  const font = "'Segoe Print', 'Ink Free', 'Bradley Hand ITC', 'Comic Sans MS', cursive";
  const jitter = (i: number, k: number) => (((seed * 31 + i * 17 + k * 7) % 9) - 4) * 0.9;
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const ruled = Array.from({ length: 10 }, (_, i) => `<line x1="70" x2="${W - 70}" y1="${top + 22 + i * rowH}" y2="${top + 22 + i * rowH}" stroke="#9db4c8" stroke-width="1.6" opacity="0.75"/>`).join("");
  const text = lines.map((ln, i) => {
    const y = top + i * rowH;
    return (Object.keys(cols) as (keyof typeof cols)[])
      .map((c, k) => `<text x="${cols[c] + jitter(i, k)}" y="${y + jitter(i, k + 3)}" font-family="${font}" font-size="${c === "note" ? 30 : 36}" fill="#1c2a4a" transform="rotate(${jitter(i, k) * 0.35} ${cols[c]} ${y})">${esc(ln[c])}</text>`)
      .join("");
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs>
      <filter id="paper" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="4" seed="${seed}" result="n"/>
        <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.93  0 0 0 0 0.89  0 0 0 0 0.78  0 0 0 0.55 0.45"/>
      </filter>
    </defs>
    <rect width="100%" height="100%" fill="#f4eedd"/>
    <rect width="100%" height="100%" filter="url(#paper)"/>
    <g transform="rotate(${seed % 2 ? -1.3 : 1.1} ${W / 2} ${H / 2})">
      <line x1="88" x2="88" y1="40" y2="${H - 40}" stroke="#d98a8a" stroke-width="2" opacity="0.8"/>
      ${ruled}
      <text x="110" y="120" font-family="${font}" font-size="50" fill="#1c2a4a">${esc(title)}</text>
      ${(Object.keys(cols) as (keyof typeof cols)[]).map((c) => `<text x="${cols[c]}" y="185" font-family="${font}" font-size="26" fill="#3a4a6e">${c === "unit" ? "apt" : c}</text>`).join("")}
      ${text}
    </g>
  </svg>`;
  // sensor noise
  const noise = Buffer.alloc(W * H * 3);
  let x = seed * 7919 + 13;
  for (let i = 0; i < noise.length; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    noise[i] = 118 + (x % 21);
  }
  const noiseImg = await sharp(noise, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
  const buf = await sharp(Buffer.from(svg))
    .composite([{ input: noiseImg, blend: "soft-light" }])
    .blur(0.5)
    .modulate({ brightness: 0.98 })
    .jpeg({ quality: 82 })
    .toBuffer();
  fs.writeFileSync(path.join(OUT, file), buf);

  const rows = lines.map((ln, i) => {
    const y = top + i * rowH - 58;
    const cell = (k: keyof typeof cols, value: string | number) => ({ value, raw: ln[k], confidence: ln.conf?.[k] ?? 0.94 });
    const [m, d] = ln.date.split("/").map(Number);
    return {
      region: { x: 60 / W, y: Math.max(0, y - 12) / H, w: (W - 120) / W, h: (rowH + 24) / H },
      cells: {
        date: cell("date", `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`),
        unit: cell("unit", ln.unit),
        name: cell("name", ln.name),
        amount: cell("amount", ln.value?.amount ?? Number(ln.amount.replace(/[$,]/g, ""))),
        note: cell("note", ln.note),
      },
    };
  });
  return { sha256: crypto.createHash("sha256").update(buf).digest("hex"), fileName: file, title, rows };
}

async function ledgers() {
  const cash = ["102", "301", "408"].map((n) => unit(n));
  const line = (u: TUnit, date: string, note: string, extra: Partial<LedgerLine> = {}): LedgerLine => ({
    date, unit: u.number, name: initial(u.lease!.residents[0]), amount: `$${tenantMonthly(u.lease!, "2026-10").toLocaleString("en-US")}`, note, ...extra,
  });
  const p1 = await ledgerImage("ledger_page_1.jpg", "Maple Ct. - cash receipts  Sept / Oct 2026", [
    line(cash[0], "9/2", "cash"), line(cash[1], "9/1", "money order"), line(cash[2], "9/3", "cash"),
    line(cash[0], "10/2", "cash"), line(cash[1], "10/1", "money order", { conf: { name: 0.71 } }), line(cash[2], "10/3", "cash"),
  ], 3, 2026);
  const p2 = await ledgerImage("ledger_page_2.jpg", "Maple Ct. - cash receipts  Nov 2026", [
    line(cash[0], "11/2", "cash"), line(cash[1], "11/1", "money order"),
    // the 5 is written like an 8 → low confidence on purpose
    line(cash[2], "11/3", "cash - rcpt #214", { amount: "$1,525", conf: { amount: 0.58 } }),
  ], 8, 2026);
  const fixture = { note: "Demo-provider fixtures: what a vision model returns for the sample ledger scans.", images: [p1, p2] };
  fs.writeFileSync(path.join(FIXTURES, "ledgers.json"), JSON.stringify(fixture, null, 2) + "\n");
}

async function main() {
  rentRollCsv();
  trackerXlsx();
  const deposits = bankCsv();
  await leasePdfs();
  await ledgers();
  console.log(`Sample data written to ${path.relative(process.cwd(), OUT)} — ${deposits} bank deposits.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
