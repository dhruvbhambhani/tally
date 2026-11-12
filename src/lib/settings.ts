import { DEFAULT_BENCHMARKS, type BenchmarkConfig } from "./metrics/benchmarks";

export type LadderStepKey = "friendly_reminder" | "second_reminder" | "payment_plan" | "formal_notice" | "attorney";

export interface LadderStep {
  key: LadderStepKey;
  label: string;
  /** suggest this step once the oldest unpaid charge is at least this many days late */
  afterDays: number;
  requiresApproval: boolean;
}

export interface Settings {
  ladder: LadderStep[];
  benchmarks: BenchmarkConfig;
  /** line included in every friendly letter */
  rentalAssistanceText: string;
  rentalAssistanceTextEs: string;
  /** flag a vacant unit once it has sat this many days */
  vacancyAlertDays: number;
  /** flag a month when more than this share of units expire in it */
  expirationFlagShare: number;
  /** number of monthly installments offered in a payment plan */
  paymentPlanMonths: number;
  ownerName: string;
}

export const DEFAULT_LADDER: LadderStep[] = [
  { key: "friendly_reminder", label: "Friendly reminder", afterDays: 1, requiresApproval: false },
  { key: "second_reminder", label: "Second reminder", afterDays: 10, requiresApproval: false },
  { key: "payment_plan", label: "Payment-plan offer", afterDays: 20, requiresApproval: false },
  { key: "formal_notice", label: "Formal notice", afterDays: 45, requiresApproval: true },
  { key: "attorney", label: "Refer to attorney", afterDays: 90, requiresApproval: true },
];

export const DEFAULT_SETTINGS: Settings = {
  ladder: DEFAULT_LADDER,
  benchmarks: DEFAULT_BENCHMARKS,
  rentalAssistanceText:
    "If you're having trouble paying, help may be available. Call 2-1-1 or visit 211.org to ask about rental assistance in your area.",
  rentalAssistanceTextEs:
    "Si tiene dificultades para pagar, puede haber ayuda disponible. Llame al 2-1-1 o visite 211.org para preguntar sobre asistencia de alquiler en su área.",
  vacancyAlertDays: 30,
  expirationFlagShare: 0.1,
  paymentPlanMonths: 3,
  ownerName: "Owner",
};

export function resolveSettings(raw: Record<string, unknown> | null | undefined): Settings {
  const r = (raw ?? {}) as Partial<Settings>;
  return {
    ...DEFAULT_SETTINGS,
    ...r,
    ladder: Array.isArray(r.ladder) && r.ladder.length ? r.ladder : DEFAULT_LADDER,
    benchmarks: {
      lossToLeasePct: { ...DEFAULT_BENCHMARKS.lossToLeasePct, ...r.benchmarks?.lossToLeasePct },
      occupancyGapPts: { ...DEFAULT_BENCHMARKS.occupancyGapPts, ...r.benchmarks?.occupancyGapPts },
    },
  };
}
