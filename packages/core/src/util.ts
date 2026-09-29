import { createHash, randomUUID } from "node:crypto";

/** JSON with bigint as string. Money never leaves the server as a float. */
export function ser<T>(v: T): unknown {
  return JSON.parse(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x)));
}
export function canonical(v: unknown): string {
  const c = (x: unknown): unknown =>
    Array.isArray(x) ? x.map(c) : x && typeof x === "object"
      ? Object.fromEntries(Object.entries(x as object).sort(([a], [b]) => a.localeCompare(b)).map(([k, y]) => [k, c(y)])) : x;
  return JSON.stringify(c(ser(v)));
}
export const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
export const newCorrelationId = () => randomUUID();

/** Format minor units as a major-unit decimal string, e.g. 310000n -> "3100.00". */
export function minorToMajor(m: bigint, decimals = 2): string {
  const neg = m < 0n;
  const a = (neg ? -m : m).toString().padStart(decimals + 1, "0");
  return `${neg ? "-" : ""}${a.slice(0, -decimals)}.${a.slice(-decimals)}`;
}
