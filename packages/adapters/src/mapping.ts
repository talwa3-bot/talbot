export type CanonicalField = "source_row_id" | "period" | "entity_id" | "department" | "account" | "amount" | "currency";
export type ColumnMapping = Partial<Record<CanonicalField, string>>;

/** Header aliases in English and Hebrew, used only to SUGGEST a mapping. A human confirms it. */
export const ALIASES: Record<CanonicalField, string[]> = {
  source_row_id: ["source_row_id", "row_id", "id", "מזהה", "מספר שורה", "אסמכתא"],
  period: ["period", "month", "תקופה", "חודש"],
  entity_id: ["entity", "entity_id", "company", "חברה", "ישות"],
  department: ["department", "dept", "cost_center", "מחלקה", "מרכז עלות"],
  account: ["account", "account_code", "gl", "חשבון", "מספר חשבון"],
  amount: ["amount", "סכום", "יתרה", "amount_usd", "amount_ils"],
  currency: ["currency", "ccy", "מטבע"],
};

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export function suggestMapping(headers: string[]): { mapping: ColumnMapping; unmapped: CanonicalField[] } {
  const mapping: ColumnMapping = {};
  const used = new Set<string>();
  for (const field of Object.keys(ALIASES) as CanonicalField[]) {
    const hit = headers.find((h) => !used.has(h) && ALIASES[field].map(norm).includes(norm(h)));
    if (hit) { mapping[field] = hit; used.add(hit); }
  }
  const unmapped = (Object.keys(ALIASES) as CanonicalField[]).filter((f) => !mapping[f]);
  return { mapping, unmapped };
}

export function applyMapping(row: Record<string, string>, mapping: ColumnMapping): Record<CanonicalField, string | undefined> {
  const out = {} as Record<CanonicalField, string | undefined>;
  for (const f of Object.keys(ALIASES) as CanonicalField[]) out[f] = mapping[f] ? row[mapping[f]!] : undefined;
  return out;
}
