import { describe, it, expect } from "vitest";
import { convertMinor, LedgerError } from "@ledgerlens/domain";

describe("FX", () => {
  it("throws MISSING_FX_RATE instead of guessing", () => {
    expect(() => convertMinor(1000n, "USD", "ILS", undefined)).toThrowError(LedgerError);
    try { convertMinor(1000n, "USD", "ILS", undefined); } catch (e) { expect((e as LedgerError).code).toBe("MISSING_FX_RATE"); }
  });
  it("same currency needs no rate", () => { expect(convertMinor(1000n, "USD", "USD", undefined)).toBe(1000n); });
  it("converts with Decimal and rounds half-even to minor units", () => {
    expect(convertMinor(1000n, "USD", "ILS", "3.5")).toBe(3500n);
    expect(convertMinor(1n, "USD", "ILS", "0.5")).toBe(0n); // 0.5 -> half-even 0
    expect(convertMinor(3n, "USD", "ILS", "0.5")).toBe(2n); // 1.5 -> 2
  });
});
