/**
 * Pure domain types. Every metric, recommendation and letter figure is computed
 * from these by deterministic functions. Money is integer cents. Dates are
 * ISO `YYYY-MM-DD` strings.
 */
export type Cents = number;
export type ISODate = string;
/** `YYYY-MM` */
export type Period = string;

export type UnitStatus = "occupied" | "vacant" | "notice" | "down" | "model" | "employee";
export const OCCUPIED_STATUSES: UnitStatus[] = ["occupied", "notice"];

export interface Unit {
  id: string;
  number: string;
  unitType: string;
  beds: number;
  baths: number;
  sqft: number;
  status: UnitStatus;
  marketRent: Cents;
  vacantSince: ISODate | null;
}

export type RecurringType = "pet" | "parking" | "storage" | "utilities" | "other";
export type ChargeType = "rent" | RecurringType | "late_fee" | "concession";
export type PayerType = "tenant" | "subsidy";

export interface RecurringCharge {
  type: RecurringType;
  amount: Cents;
  /** false = the lease calls for it but it is not on the billing rent roll */
  billed: boolean;
}

export interface Concession {
  label: string;
  monthlyAmount: Cents;
  endsOn: ISODate;
}

export interface Subsidy {
  /** what is being billed today */
  tenantPortion: Cents;
  hapPortion: Cents;
  /** what the lease / HAP contract says, when a lease is on file */
  leaseTenantPortion: Cents | null;
  leaseHapPortion: Cents | null;
}

export interface Lease {
  id: string;
  unitId: string;
  residents: string[];
  start: ISODate;
  end: ISODate | null;
  mtm: boolean;
  contractRent: Cents;
  recurring: RecurringCharge[];
  concessions: Concession[];
  depositHeld: Cents;
  depositRequired: Cents | null;
  subsidy: Subsidy | null;
  /** true only when a lease on file authorizes a late fee; null = no lease on file */
  lateFeeAuthorized: boolean | null;
  /** monthly premium the lease allows once month-to-month; null = unknown */
  mtmPremium: Cents | null;
}

export interface Charge {
  id: string;
  leaseId: string;
  type: ChargeType;
  /** negative for concessions (credits) */
  amount: Cents;
  dueDate: ISODate;
  period: Period;
  payer: PayerType;
}

export interface Payment {
  id: string;
  /** null = deposit not matched to any lease */
  leaseId: string | null;
  amount: Cents;
  date: ISODate;
  payer: string;
  memo: string;
  method: string;
  payerType: PayerType;
}

export interface LateFeePolicy {
  /** rent is late when paid after this day of the month */
  graceDay: number;
  amount: Cents;
}

export interface Snapshot {
  asOf: ISODate;
  units: Unit[];
  leases: Lease[];
  charges: Charge[];
  payments: Payment[];
}
