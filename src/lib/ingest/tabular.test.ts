import { describe, expect, it } from "vitest";
import { classifyTable, findHeaderRow, parseStatus, suggestMapping } from "./tabular";

describe("rent roll exports from property-management software", () => {
  const cases: [string, string[]][] = [
    ["Yardi-style", ["Unit", "Unit Type", "Unit Sq Ft", "Resident", "Name", "Market Rent", "Actual Rent", "Resident Deposit", "Other Deposit", "Move In", "Lease Expiration", "Move Out", "Balance"]],
    ["Buildium-style", ["Unit", "BD/BA", "Tenants", "Status", "Sqft", "Market Rent", "Rent", "Deposit", "Lease From", "Lease To", "Move-in"]],
    ["RealPage-style", ["Bldg/Unit", "Floorplan", "SQFT", "Unit/Lease Status", "Name", "Move-In", "Lease Start", "Lease End", "Market Rent", "Lease Rent", "Total Deposits"]],
    ["Landlord sheet", ["Apt #", "Tenant Name", "Monthly Rent", "Security Deposit", "Lease Start", "Lease Expires"]],
  ];
  it.each(cases)("%s headers are recognized as a rent roll with unit, resident, rent and lease end mapped", (_name, headers) => {
    expect(findHeaderRow([["Rent Roll"], [], headers])).toBe(2);
    expect(classifyTable(headers, "Sheet1")).toBe("rent_roll");
    const m = suggestMapping(headers, "rent_roll");
    expect(m.unit).toBeTruthy();
    expect(m.tenant).toBeTruthy();
    expect(m.rent).toBeTruthy();
    expect(m.leaseEnd).toBeTruthy();
  });
  it("reads the status words software uses", () => {
    expect(parseStatus("Occupied No Notice", "A B")).toBe("occupied");
    expect(parseStatus("Notice Unrented", "A B")).toBe("notice");
    expect(parseStatus("Vacant Unrented Ready", "")).toBe("vacant");
  });
  it("never maps one column to two fields, and prefers the name over a resident code", () => {
    const m = suggestMapping(cases[0][1], "rent_roll");
    expect(m.tenant).toBe("Name");
    expect(new Set(Object.values(m)).size).toBe(Object.values(m).length);
  });
});
