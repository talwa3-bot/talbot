import type { QueryAst } from "@ledgerlens/query";

export type Intent =
  | { kind: "query"; ast: QueryAst; assumptions: string[] }
  | { kind: "clarify"; reason: "period" | "metric" | "relative_period"; };

const HE_MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
const EN_MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const HE_ORD: Record<string, number> = { "ראשון": 1, "הראשון": 1, "שני": 2, "השני": 2, "שלישי": 3, "השלישי": 3, "רביעי": 4, "הרביעי": 4 };
const EN_ORD: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4 };

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Deterministic parser: Hebrew and English map to the same canonical AST.
 * The model never builds the query. Unknown or relative periods ask the user.
 */
export function parseQuestion(question: string, ctx: { defaultYear: number; departments: Array<{ code: string; label_he: string; label_en: string }> }): Intent {
  let q = question.toLowerCase().replace(/[?？!.,״"׳']/g, " ").replace(/\s+/g, " ");
  const assumptions: string[] = [];

  let metric: "opex" | "revenue" | undefined;
  const OPEX = /(הוצאות (ה)?תפעול|הוצאות תפעוליות|הוצאות|operating[- ]expenses?|operating[- ]expense|opex|expenses?)/;
  const REV = /(הכנסות|revenue|sales revenue)/;
  if (OPEX.test(q)) { metric = "opex"; q = q.replace(OPEX, " "); }
  else if (REV.test(q)) { metric = "revenue"; q = q.replace(REV, " "); }
  if (!metric) return { kind: "clarify", reason: "metric" };

  if (/(last|previous|this) (quarter|month)|רבעון (שעבר|קודם|האחרון|הנוכחי)|הרבעון (שעבר|הקודם|האחרון|הנוכחי)|חודש (שעבר|קודם)|החודש/.test(q)) {
    return { kind: "clarify", reason: "relative_period" };
  }

  const yearM = q.match(/\b(20\d\d)\b/);
  const year = yearM ? Number(yearM[1]) : ctx.defaultYear;
  let from: string | undefined, to: string | undefined;

  const qn = q.match(/\bq([1-4])\b/) ?? q.match(/(?:ה)?רבעון (?:ה)?([1-4])\b/);
  const qHe = q.match(/(?:ב|ה)?רבעון (ה?(?:ראשון|שני|שלישי|רביעי))/);
  const qEn = q.match(/\b(first|second|third|fourth) quarter\b/);
  const quarter = qn ? Number(qn[1]) : qHe ? HE_ORD[qHe[1]!] : qEn ? EN_ORD[qEn[1]!] : undefined;
  if (quarter) { from = `${year}-${pad(quarter * 3 - 2)}`; to = `${year}-${pad(quarter * 3)}`; }
  else {
    const iso = q.match(/\b(20\d\d)-(0[1-9]|1[0-2])\b/);
    const mi = HE_MONTHS.findIndex((m) => q.includes(m));
    const me = EN_MONTHS.findIndex((m) => new RegExp(`\\b${m}\\b`).test(q));
    const month = iso ? Number(iso[2]) : mi >= 0 ? mi + 1 : me >= 0 ? me + 1 : undefined;
    if (month) { from = to = `${iso ? iso[1] : year}-${pad(month)}`; }
  }
  if (!from || !to) return { kind: "clarify", reason: "period" };
  if (!yearM) assumptions.push(`year=${year}`);

  const dept = ctx.departments.find((d) => q.includes(d.label_he.toLowerCase()) || new RegExp(`\\b${d.label_en.toLowerCase()}\\b`).test(q) || new RegExp(`\\b${d.code}\\b`).test(q));
  const ast: QueryAst = {
    metric, aggregation: "sum", period: { from, to }, entity_ids: [], group_by: ["department"],
    compare_to: { kind: "budget", version_id: "" },
    ...(dept ? { filters: { department_ids: [dept.code] } } : {}),
  };
  return { kind: "query", ast, assumptions };
}
