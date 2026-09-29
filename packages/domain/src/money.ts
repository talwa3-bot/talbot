import Decimal from "decimal.js";
import { LedgerError } from "./errors.js";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });

/** Convert minor units between currencies. A missing rate is an error, never a guess. */
export function convertMinor(amountMinor: bigint, from: string, to: string, rate: string | undefined): bigint {
  if (from === to) return amountMinor;
  if (rate === undefined || rate === "") {
    throw new LedgerError("MISSING_FX_RATE", `No FX rate for ${from}->${to}`);
  }
  const out = new Decimal(amountMinor.toString()).mul(new Decimal(rate)).toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN);
  return BigInt(out.toFixed(0));
}

export function assertMinor(n: unknown): bigint {
  if (typeof n === "bigint") return n;
  if (typeof n === "number" && Number.isSafeInteger(n)) return BigInt(n);
  throw new LedgerError("INVALID_AMOUNT", `Amount must be an integer in minor units, got ${String(n)}`);
}

export { Decimal };
