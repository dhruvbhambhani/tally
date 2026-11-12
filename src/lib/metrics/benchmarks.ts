export interface BenchmarkRange {
  min: number;
  max: number;
  /** where the range came from — shown to the owner in a tooltip */
  source: string;
}

export interface BenchmarkConfig {
  /** loss-to-lease as a % of gross potential rent */
  lossToLeasePct: BenchmarkRange;
  /** physical occupancy minus economic occupancy, in percentage points */
  occupancyGapPts: BenchmarkRange;
}

const DEFAULT_SOURCE =
  "Tally's starting rule of thumb, not a market survey. Change it in Settings to match your market.";

export const DEFAULT_BENCHMARKS: BenchmarkConfig = {
  lossToLeasePct: { min: 0, max: 5, source: DEFAULT_SOURCE },
  occupancyGapPts: { min: 0, max: 7, source: DEFAULT_SOURCE },
};

export interface BenchmarkResult {
  key: keyof BenchmarkConfig;
  label: string;
  value: number;
  unit: "%" | "pts";
  range: BenchmarkRange;
  status: "within" | "above" | "below";
}

function evaluate(value: number, range: BenchmarkRange): BenchmarkResult["status"] {
  if (value > range.max) return "above";
  if (value < range.min) return "below";
  return "within";
}

export function evaluateBenchmarks(
  input: { gpr: number; lossToLease: number; physicalOccupancy: number | null; economicOccupancy: number | null },
  config: BenchmarkConfig = DEFAULT_BENCHMARKS,
): BenchmarkResult[] {
  const out: BenchmarkResult[] = [];
  if (input.gpr > 0) {
    const v = round1((input.lossToLease / input.gpr) * 100);
    out.push({ key: "lossToLeasePct", label: "Below-market leases", value: v, unit: "%", range: config.lossToLeasePct, status: evaluate(v, config.lossToLeasePct) });
  }
  if (input.physicalOccupancy != null && input.economicOccupancy != null) {
    const v = round1((input.physicalOccupancy - input.economicOccupancy) * 100);
    out.push({ key: "occupancyGapPts", label: "Occupied vs. paid gap", value: v, unit: "pts", range: config.occupancyGapPts, status: evaluate(v, config.occupancyGapPts) });
  }
  return out;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
