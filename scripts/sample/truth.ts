/**
 * The "truth" behind the Maple Court demo. Every sample file is rendered from
 * this model, then deliberately made messy (different column names, abbreviated
 * names, three rent-roll errors). All people and addresses are fictional.
 */
export const AS_OF = "2026-11-10";
export const PROPERTY = {
  name: "Maple Court",
  address: "418 Larkmoor Lane",
  city: "Austin",
  state: "TX",
  zip: "78745",
  owner: "Larkmoor Holdings LLC",
};
/** First month covered by the landlord's payment log. */
export const LEDGER_START = "2026-06";
export const LEDGER_MONTHS = ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];

export interface TLease {
  residents: string[];
  start: string;
  end: string;
  mtm?: boolean;
  rent: number;
  pet?: number;
  parking?: number;
  storage?: number;
  utilities?: number;
  concession?: { amount: number; endsOn: string };
  deposit: number;
  subsidy?: { tenant: number; hap: number };
  method: "zelle" | "ach" | "check" | "cash";
  /** bank shows "J SMITH" instead of the full name */
  bankInitial?: boolean;
  /** tracker sheet shows "J. Smith" */
  sheetInitial?: boolean;
  notes?: string;
}

export interface TUnit {
  number: string;
  type: string;
  beds: number;
  baths: number;
  sqft: number;
  market: number;
  status: "occupied" | "vacant" | "notice";
  vacantSince?: string;
  lease?: TLease;
}

const TYPES = {
  "1BR": { type: "1BR/1BA", beds: 1, baths: 1, sqft: 650, market: 1250 },
  "2B1": { type: "2BR/1BA", beds: 2, baths: 1, sqft: 850, market: 1550 },
  "2B2": { type: "2BR/2BA", beds: 2, baths: 2, sqft: 950, market: 1700 },
  ST: { type: "Studio", beds: 0, baths: 1, sqft: 450, market: 995 },
};
function typeFor(n: number) {
  const pos = n % 100;
  return pos <= 5 ? TYPES["1BR"] : pos <= 9 ? TYPES["2B1"] : pos <= 11 ? TYPES["2B2"] : TYPES.ST;
}

type Row = [unit: number, residents: string, gap: number, endMonth: string, extra?: Partial<TLease> & { startOverride?: string }];

// endMonth: YYYY-MM the lease ends (last day), or "MTM:YYYY-MM" for expired, month-to-month leases
const ROWS: Row[] = [
  [101, "Marcus Bell", 100, "2026-12", { parking: 50 }],
  [102, "Priya Raman", 0, "2027-03", { pet: 35, method: "cash" }],
  [103, "Darnell Whitaker", 50, "2027-04", { notes: "Said he'll catch up after the 15th" }],
  [104, "Sofia Lindqvist", 25, "2027-06", { parking: 50 }],
  [105, "Theo Nakamura", 0, "2027-06", { startOverride: "2026-07-01", concession: { amount: 200, endsOn: "2026-12-31" } }],
  [106, "Hannah Brandt", 50, "2026-11", { utilities: 40, notes: "Gave notice, moving out 11/30" }],
  [107, "Rosa Delgado", 0, "2027-10", { subsidy: { tenant: 500, hap: 1050 } }],
  [108, "Caleb Mwangi", 25, "2027-06", { sheetInitial: true }],
  [109, "Irene Castellano", 50, "2027-03", { pet: 35 }],
  [110, "Victor Hales", 50, "2027-06", { parking: 50, method: "check" }],
  [111, "Amara Osei", 0, "2027-04", { storage: 25, bankInitial: true }],
  [112, "Jonah Pruitt", 0, "2027-05"],
  [201, "Lucia Ferraro", 50, "2027-03", { parking: 50 }],
  [202, "Owen Gallagher", 125, "2027-01", { method: "ach" }],
  [203, "Mei-Ling Zhou", 0, "2027-04", { pet: 35, sheetInitial: true }],
  [205, "Andre Baptiste", 25, "2027-05", { utilities: 40 }],
  [206, "Nadia Haddad", 150, "2026-12", { bankInitial: true }],
  [207, "Elliot Ramsey", 0, "2027-06", { pet: 35 }],
  [208, "Tasha Kimbrough", 50, "2027-05"],
  [209, "Samuel Ortega", 0, "2027-07", { utilities: 40, concession: { amount: 100, endsOn: "2027-01-31" } }],
  [210, "Grace Liu & Daniel Park", 25, "2027-07", { parking: 50 }],
  [211, "Walter Jennings", 100, "MTM:2026-08"],
  [212, "Bianca Moretti", 20, "2027-07", { storage: 25, method: "check" }],
  [301, "Hector Salinas", 50, "2027-07", { method: "cash" }],
  [302, "Olive Thornton", 75, "MTM:2026-05", { method: "ach" }],
  [303, "Rajesh Iyer", 0, "2027-01", { parking: 50 }],
  [304, "Fiona Mackay", 50, "2027-06", { sheetInitial: true }],
  [305, "Jamal Greene & Keisha Greene", 0, "2027-08", { pet: 35 }],
  [306, "Peter Novak", 150, "2027-06", { deposit: 1000 }],
  [308, "Ana Ribeiro", 25, "2027-08", { storage: 25 }],
  [309, "Tobias Engel", 100, "2027-01", { parking: 50 }],
  [310, "Derek Vaughn", 50, "2027-08", { notes: "Lost job in August" }],
  [311, "Yuki Tanabe", 25, "2027-09", { pet: 35, method: "ach" }],
  [312, "Camille Dufour", 75, "2026-12"],
  [401, "Isaac Romero", 25, "2027-06", { parking: 50, bankInitial: true }],
  [402, "Leah Abramson", 0, "2027-09", { utilities: 40 }],
  [403, "Kofi Mensah", 50, "2027-03", { utilities: 40 }],
  [404, "Stella Marchetti", 25, "2027-04", { pet: 35, method: "check" }],
  [405, "Gordon Pike", 50, "MTM:2025-12"],
  [406, "Nia Caldwell", 50, "2027-05", { parking: 50 }],
  [407, "Miriam Soto", 0, "2027-06", { subsidy: { tenant: 450, hap: 1100 } }],
  [408, "Emil Kowalski", 25, "2027-09", { method: "cash" }],
  [409, "Carmen Vidal & Luis Vidal", 0, "2027-10", { utilities: 40 }],
  [410, "Aisha Farouk", 50, "2027-01", { parking: 50, method: "ach" }],
  [412, "Brent Holloway", 45, "2027-10", { notes: "No response to texts" }],
];

const VACANT: Record<number, string> = { 204: "2026-10-29", 307: "2026-09-24", 411: "2026-08-19" };

function lastDay(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
function startFor(end: string): string {
  const d = new Date(end + "T00:00:00Z");
  const oneYear = new Date(Date.UTC(d.getUTCFullYear() - 1, d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
  if (oneYear <= "2026-06-01") return oneYear;
  return new Date(Date.UTC(d.getUTCFullYear() - 2, d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
}

export const UNITS: TUnit[] = [];
for (const floor of [1, 2, 3, 4]) {
  for (let pos = 1; pos <= 12; pos++) {
    const n = floor * 100 + pos;
    const t = typeFor(n);
    const row = ROWS.find((r) => r[0] === n);
    if (!row) {
      UNITS.push({ number: String(n), ...t, status: "vacant", vacantSince: VACANT[n] });
      continue;
    }
    const [, residents, gap, endMonth, extra = {}] = row;
    const mtm = endMonth.startsWith("MTM:");
    const end = lastDay(endMonth.replace("MTM:", ""));
    const { startOverride, ...rest } = extra;
    const rent = t.market - gap;
    UNITS.push({
      number: String(n), ...t,
      status: n === 106 ? "notice" : "occupied",
      lease: {
        residents: residents.split(" & "),
        start: startOverride ?? startFor(end),
        end, mtm, rent, deposit: rent, method: "zelle", ...rest,
      },
    });
  }
}

export const unit = (n: number | string) => UNITS.find((u) => u.number === String(n))!;

/** What the tenant owes each month (their share of rent + billed extras − concession). */
export function tenantMonthly(l: TLease, period: string): number {
  const rent = l.subsidy ? l.subsidy.tenant : l.rent;
  const conc = l.concession && l.concession.endsOn >= `${period}-01` ? l.concession.amount : 0;
  return rent + (l.pet ?? 0) + (l.parking ?? 0) + (l.storage ?? 0) + (l.utilities ?? 0) - conc;
}

// ----- Payment behavior, June–October (the landlord's payment log) -----
/** unit → period → day paid (late), overriding the usual on-time day */
export const LATE_DAYS: Record<string, Record<string, number>> = {
  "201": { "2026-06": 8, "2026-07": 9, "2026-09": 7, "2026-10": 10 },
  "305": { "2026-07": 11, "2026-08": 8, "2026-10": 9 },
  "109": { "2026-08": 12, "2026-10": 7 },
  "406": { "2026-09": 15 },
};
/** unit → period → amount actually paid (missing = paid in full; 0 = nothing) and day */
export const SHORT_PAYS: Record<string, Record<string, { amount: number; day: number }>> = {
  "103": { "2026-10": { amount: 600, day: 9 } },
  "310": { "2026-09": { amount: 500, day: 12 }, "2026-10": { amount: 0, day: 0 } },
  "412": { "2026-07": { amount: 0, day: 0 }, "2026-08": { amount: 950, day: 14 }, "2026-09": { amount: 0, day: 0 }, "2026-10": { amount: 0, day: 0 } },
};
/** Late fees the owner actually charged — applied to some late payers and not others. */
export const LATE_FEES_CHARGED: { unit: string; date: string; amount: number; paidWithRent: boolean }[] = [
  { unit: "201", date: "2026-07-06", amount: 50, paidWithRent: true },
  { unit: "201", date: "2026-10-06", amount: 50, paidWithRent: true },
  { unit: "103", date: "2026-10-06", amount: 50, paidWithRent: false },
];

// ----- November (the bank statement) -----
export const NOV_NO_PAYMENT = ["103", "310", "412"];
export const NOV_PARTIAL: Record<string, number> = { "208": 800 };
export const NOV_LATE_DAY: Record<string, number> = { "201": 8, "305": 7, "112": 6 };
export const SPLIT_PAYERS = ["210", "305", "409"];

export function usualDay(unitNumber: string, monthIndex: number): number {
  return 1 + ((Number(unitNumber) * 7 + monthIndex * 3) % 4);
}

// ----- Lease PDFs: what each lease document says (may differ from the rent roll) -----
export interface LeaseDoc {
  unit: string;
  rent: number;
  deposit: number;
  petFee?: number;
  lateFee?: { amount: number; afterDay: number };
  mtmPremium?: number;
  concession?: { amount: number; endsOn: string };
  subsidy?: { tenant: number; hap: number };
}
export const LEASE_DOCS: LeaseDoc[] = [
  // Rent roll bills $1,400 and holds a $1,000 deposit — the lease says otherwise.
  { unit: "306", rent: 1450, deposit: 1450, lateFee: { amount: 50, afterDay: 5 } },
  // Lease has a $35 pet fee that is not on the rent roll.
  { unit: "108", rent: 1525, deposit: 1525, petFee: 35, lateFee: { amount: 50, afterDay: 5 } },
  // Expired Aug 31, 2026 → month-to-month, with a premium the owner is not charging. No late-fee clause.
  { unit: "211", rent: 1600, deposit: 1600, mtmPremium: 100 },
  // Voucher split in the lease differs from what is being billed (450 / 1,100).
  { unit: "407", rent: 1550, deposit: 1550, lateFee: { amount: 50, afterDay: 5 }, subsidy: { tenant: 420, hap: 1130 } },
  { unit: "105", rent: 1250, deposit: 1250, lateFee: { amount: 50, afterDay: 5 }, concession: { amount: 200, endsOn: "2026-12-31" } },
];
