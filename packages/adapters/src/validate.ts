export type GateCode =
  | "DUPLICATE_ROW" | "UNKNOWN_ACCOUNT" | "MISSING_PERIOD" | "CONTROL_TOTAL_MISMATCH"
  | "INVALID_CURRENCY" | "INVALID_AMOUNT" | "INVALID_PERIOD" | "MISSING_FIELD" | "UNKNOWN_DEPARTMENT";

export interface RawRow { source_row_id?: string; period?: string; account?: string; amount_minor?: unknown; currency?: string; [k: string]: unknown }
export interface GateError { code: GateCode; source_row_id?: string; message: string }
export interface ValidationResult { ok: boolean; errors: GateError[]; quarantined: RawRow[]; controlTotalMinor: bigint }
export interface ValidateOptions { accounts: string[]; expectedPeriods: string[]; currency: string; controlTotalMinor?: bigint; departments?: string[] }

const major = (m: bigint) => { const neg = m < 0n, a = (neg ? -m : m).toString().padStart(3, "0"); return `${neg ? "-" : ""}${a.slice(0, -2)}.${a.slice(-2)}`; };
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const CCY = /^[A-Z]{3}$/;

/** Import gates. Any error blocks publication; the prior approved snapshot is kept. */
export function validateActuals(rows: RawRow[], opts: ValidateOptions): ValidationResult {
  const errors: GateError[] = [];
  const quarantined: RawRow[] = [];
  const seen = new Set<string>();
  const periods = new Set<string>();
  const known = new Set(opts.accounts);
  let total = 0n;

  for (const r of rows) {
    const id = r.source_row_id;
    const fail = (code: GateCode, message: string, q = false) => {
      errors.push({ code, source_row_id: id, message });
      if (q) quarantined.push(r);
    };
    if (!id) { fail("MISSING_FIELD", "source_row_id is required"); continue; }
    if (seen.has(id)) { fail("DUPLICATE_ROW", `Duplicate source_row_id ${id}`); continue; }
    seen.add(id);
    if (!r.period || !PERIOD.test(r.period)) fail("INVALID_PERIOD", `Bad period ${String(r.period)}`);
    else periods.add(r.period);
    if (!r.currency || !CCY.test(r.currency) || r.currency !== opts.currency) fail("INVALID_CURRENCY", `Bad currency ${String(r.currency)}`);
    if (!r.account || !known.has(r.account)) fail("UNKNOWN_ACCOUNT", `Unknown account ${String(r.account)}`, true);
    if (opts.departments && !opts.departments.includes(String(r.department))) fail("UNKNOWN_DEPARTMENT", `Unknown department ${String(r.department)}`, true);
    if (typeof r.amount_minor === "number" && Number.isSafeInteger(r.amount_minor)) total += BigInt(r.amount_minor);
    else if (typeof r.amount_minor === "bigint") total += r.amount_minor;
    else fail("INVALID_AMOUNT", `Amount must be an integer in minor units, got ${String(r.amount_minor)}`);
  }

  for (const p of opts.expectedPeriods) {
    if (!periods.has(p)) errors.push({ code: "MISSING_PERIOD", message: `No rows for period ${p}` });
  }
  if (opts.controlTotalMinor !== undefined && total !== opts.controlTotalMinor) {
    errors.push({ code: "CONTROL_TOTAL_MISMATCH", message: `Rows sum to ${major(total)}, control total is ${major(opts.controlTotalMinor)}` });
  }
  return { ok: errors.length === 0, errors, quarantined, controlTotalMinor: total };
}
