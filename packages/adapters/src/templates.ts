const HEADER = "source_row_id,period,entity_id,department,account,amount,currency";
export const actualsTemplateCsv = () => `${HEADER}\nA-0001,2026-01,ent_demo,sales,6000,12000.00,USD\n`;
export const planTemplateCsv = () => `${HEADER}\nP-0001,2026-01,ent_demo,sales,6000,10000.00,USD\n`;

/** Neutralize spreadsheet formula injection when exporting untrusted text. */
export function csvSafeCell(v: string): string {
  const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
