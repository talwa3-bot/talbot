import { LedgerError } from "@ledgerlens/domain";
import type { LedgerLens, Principal } from "@ledgerlens/core";
import { minorToMajor } from "@ledgerlens/core";
import { parseQuestion } from "./intent.js";
import { validateNarrative, type Sentence } from "./validator.js";
import { TemplateModel, type ModelGateway } from "./gateway.js";

const M = {
  "he-IL": {
    clarify_period: "לאיזו תקופה? לדוגמה: ינואר 2026, או רבעון ראשון 2026.",
    clarify_relative: "״הרבעון הקודם״ תלוי בלוח השנה הכספי. לאיזה רבעון ושנה הכוונה? לדוגמה: רבעון ראשון 2026.",
    clarify_metric: "על איזה מדד לענות? הוצאות תפעול או הכנסות.",
    lead: (m: string, p: string, a: string, b: string, v: string, pct: string, c: string) => `${m}, ${p}: ביצוע ${a} מול תקציב ${b}. סטייה ${v} ${c} (${pct}).`,
    lead_partial: (m: string, p: string) => `${m}, ${p}: מוצגות רק המחלקות שיש לך הרשאה אליהן. סך כולל מוסתר כדי לא לחשוף מחלקות אחרות.`,
    opex: "הוצאות תפעול", revenue: "הכנסות",
    assumed_year: (y: string) => `הנחתי את שנת ${y}, השנה של נתוני הביצוע האחרונים שפורסמו.`,
    limit_obs: "הסטייה היא מדידה חשבונית. היא לא מסבירה סיבה, אלא אם יש הערה מאושרת.",
    model_rejected: "תשובת המודל נדחתה באימות הציטוטים, ולכן מוצג נוסח קבוע שנבנה מהתוצאות.",
  },
  "en-US": {
    clarify_period: "Which period? For example: January 2026, or Q1 2026.",
    clarify_relative: "\"Last quarter\" depends on the fiscal calendar. Which quarter and year? For example: Q1 2026.",
    clarify_metric: "Which metric: operating expenses or revenue?",
    lead: (m: string, p: string, a: string, b: string, v: string, pct: string, c: string) => `${m}, ${p}: actual ${a} vs budget ${b}. Variance ${v} ${c} (${pct}).`,
    lead_partial: (m: string, p: string) => `${m}, ${p}: showing only departments you are authorized to see. The total is withheld so other departments cannot be inferred.`,
    opex: "Operating expenses", revenue: "Revenue",
    assumed_year: (y: string) => `Assumed year ${y}, the year of the latest published actuals.`,
    limit_obs: "Variance is arithmetic. It does not explain a cause unless an approved note says so.",
    model_rejected: "The model's answer failed citation checks, so a fixed wording built from the results is shown.",
  },
} as const;

export interface Answer {
  status: "answer" | "clarify" | "abstain";
  locale: "he-IL" | "en-US";
  question: string;
  clarification?: string;
  error_code?: string;
  lead?: string;
  ast?: unknown;
  table?: Array<{ result_id: string; key: string; label: string; actual: string; plan: string; variance: string; variance_pct: string; direction: string }>;
  total?: { result_id: string; actual: string; plan: string; variance: string; variance_pct: string; direction: string } | null;
  narrative?: Sentence[];
  narrative_source?: string;
  model_rejected?: string[];
  assumptions?: string[];
  limitations?: string[];
  meta?: { currency: string; snapshot_id: string; plan_version_id: string; as_of: string; period: { from: string; to: string } };
}

export async function ask(svc: LedgerLens, p: Principal, question: string, locale: "he-IL" | "en-US", model: ModelGateway = new TemplateModel()): Promise<Answer> {
  const t = M[locale];
  if (!question?.trim() || question.length > 500) return { status: "clarify", locale, question, clarification: t.clarify_period };
  const dims = await svc.dimensions(p);
  const years = (dims.current_snapshot?.periods ?? []).map((x: string) => Number(x.slice(0, 4)));
  const defaultYear = years.length ? Math.max(...years) : new Date().getUTCFullYear();
  const intent = parseQuestion(question, { defaultYear, departments: dims.departments });
  if (intent.kind === "clarify") {
    return { status: "clarify", locale, question, clarification: intent.reason === "relative_period" ? t.clarify_relative : intent.reason === "metric" ? t.clarify_metric : t.clarify_period };
  }
  let q;
  try {
    q = await svc.query(p, intent.ast);
  } catch (e) {
    if (e instanceof LedgerError) return { status: e.code === "AMBIGUOUS_PERIOD" ? "clarify" : "abstain", locale, question, error_code: e.code, clarification: e.message };
    throw e;
  }
  const label = (code: string) => { const d = dims.departments.find((x: { code: string }) => x.code === code); return d ? (locale === "he-IL" ? d.label_he : d.label_en) : code; };
  const fmt = (r: typeof q.rows[number]) => ({
    result_id: r.result_id, key: r.group.department ?? "", label: label(r.group.department ?? ""),
    actual: minorToMajor(r.actual_minor), plan: minorToMajor(r.plan_minor), variance: minorToMajor(r.variance_minor), variance_pct: r.variance_pct, direction: r.direction,
  });
  const table = q.rows.map(fmt);
  const total = q.total ? { ...fmt(q.total), key: "", label: "" } : null;
  const { from, to } = intent.ast.period!;
  const periodLabel = from === to ? from : `${from}..${to}`;
  const metricName = t[intent.ast.metric as "opex" | "revenue"];
  const pctTxt = (v: string) => (v === "n/a" ? "n/a" : `${v}%`);
  const lead = total ? t.lead(metricName, periodLabel, total.actual, total.plan, total.variance, pctTxt(total.variance_pct), q.currency) : t.lead_partial(metricName, periodLabel);

  const months: string[] = [];
  for (let m = from; m <= to; ) { months.push(m); const [y, mm] = m.split("-").map(Number) as [number, number]; m = mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, "0")}`; }
  const notes = await svc.approvedNotes(p, months, table.map((r) => r.key));
  const citable = [...(total ? [total] : []), ...table].map((r) => ({ result_id: r.result_id, numbers: [r.actual, r.plan, r.variance, r.variance_pct] }));
  const ctxNumbers = [...new Set([from, to].flatMap((x) => [x.slice(0, 4), String(Number(x.slice(5)))]))];
  if (from !== to) { const qn = Math.ceil(Number(from.slice(5)) / 3); ctxNumbers.push(String(qn)); }
  const input = { locale, period_label: periodLabel, results: [...(total ? [{ ...total, label: locale === "he-IL" ? "סך הכול" : "Total" }] : []), ...table], notes };

  let narrative: Sentence[] = [];
  let source = model.name;
  let rejected: string[] | undefined;
  try {
    const raw = JSON.parse(await model.narrate(input));
    const v = validateNarrative(raw?.sentences, citable, notes.map((n) => n.note_id), ctxNumbers);
    if (v.ok) narrative = raw.sentences; else rejected = v.reasons;
  } catch (e) {
    rejected = [`model error: ${(e as Error).message}`];
  }
  if (rejected) {
    source = "template";
    narrative = JSON.parse(await new TemplateModel().narrate(input)).sentences;
  }
  return {
    status: "answer", locale, question, lead, ast: intent.ast, table, total, narrative, narrative_source: source, model_rejected: rejected,
    assumptions: intent.assumptions.map((a) => (a.startsWith("year=") ? t.assumed_year(a.slice(5)) : a)),
    limitations: [t.limit_obs, ...(rejected ? [t.model_rejected] : [])],
    meta: { currency: q.currency, snapshot_id: q.snapshot_id, plan_version_id: q.plan_version_id, as_of: q.as_of, period: { from, to } },
  };
}
