/** Parse a decimal string ("1,234.56", "(500.00)", "-7") into minor units without floats. */
export function parseAmountMinor(input: string, decimals = 2): bigint {
  let s = input.trim();
  if (s === "") throw new Error("INVALID_AMOUNT: empty");
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.startsWith("-")) { neg = !neg; s = s.slice(1); }
  s = s.replace(/,/g, "");
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new Error(`INVALID_AMOUNT: ${input}`);
  const frac = m[2] ?? "";
  if (frac.length > decimals) throw new Error(`INVALID_AMOUNT: more than ${decimals} decimals in ${input}`);
  const minor = BigInt(m[1]! + frac.padEnd(decimals, "0"));
  return neg ? -minor : minor;
}
