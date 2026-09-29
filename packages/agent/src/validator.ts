export interface CitableResult { result_id: string; numbers: string[]; }
export interface Sentence { text: string; cites: string[] }
export interface Verdict { ok: boolean; reasons: string[] }

const CAUSAL = /\b(because|due to|caused by|driven by|as a result of|owing to)\b|בגלל|עקב|בשל|נגרם|כתוצאה מ/i;

/** Normalize "3,100.00" / "-3100" / "5.74%" to a canonical absolute decimal string. */
export function normNumber(s: string): string {
  let x = s.replace(/[,%\s]/g, "").replace(/^-/, "");
  if (x.includes(".")) x = x.replace(/0+$/, "").replace(/\.$/, "");
  return x.replace(/^0+(?=\d)/, "");
}

/**
 * Rejects any narrative that contains a number not present in the results it cites,
 * cites an unknown ID, or claims a cause without citing an approved human note.
 */
export function validateNarrative(sentences: unknown, results: CitableResult[], noteIds: string[], contextNumbers: string[]): Verdict {
  const reasons: string[] = [];
  if (!Array.isArray(sentences) || sentences.length === 0) return { ok: false, reasons: ["no sentences"] };
  const byId = new Map(results.map((r) => [r.result_id, r]));
  const ctx = new Set(contextNumbers.map(normNumber));
  for (const [i, s] of (sentences as Sentence[]).entries()) {
    if (!s || typeof s.text !== "string" || !Array.isArray(s.cites)) { reasons.push(`#${i}: malformed`); continue; }
    if (s.cites.length === 0) reasons.push(`#${i}: no citation`);
    const unknown = s.cites.filter((c) => !byId.has(c) && !noteIds.includes(c));
    if (unknown.length) reasons.push(`#${i}: unknown citation ${unknown.join(",")}`);
    const allowed = new Set([...ctx, ...s.cites.flatMap((c) => byId.get(c)?.numbers ?? []).map(normNumber)]);
    const text = s.text.replace(/\bres_[0-9a-f]+\b/g, " ").replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, " ");
    for (const n of text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []) {
      if (!allowed.has(normNumber(n))) reasons.push(`#${i}: number ${n} not in cited results`);
    }
    if (CAUSAL.test(s.text) && !s.cites.some((c) => noteIds.includes(c))) reasons.push(`#${i}: causal claim without an approved note`);
  }
  return { ok: reasons.length === 0, reasons };
}
