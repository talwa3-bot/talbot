const test = require('node:test');
const assert = require('node:assert');
const C = require('../src/lib/calc.js');
const K = require('../src/lib/classify.js');
const PL = require('../src/lib/pipeline.js');

const D = (y, m, d) => C.dayNum(y, m, d);
const mk = (seq, date, desc, debit, credit) => ({ seq, srcRow: seq + 2, date, desc, debit: debit || 0, credit: credit || 0, kind: 'move', excluded: false });

test('סיווג לפי מילות מפתח', () => {
  const c = (desc, debit, credit) => K.classifyRow({ desc, debit, credit, kind: 'move' }).cat;
  assert.strictEqual(c('משכורת ינואר', 0, 10000), 'salary');
  assert.strictEqual(c('חלוקת דיבידנד', 0, 50000), 'dividend');
  assert.strictEqual(c('משיכת בעלים', 5000, 0), 'withdrawal');
  assert.strictEqual(c('החזר הלוואה', 0, 3000), 'repay');
  assert.strictEqual(c('הלוואה לבעל מניות', 20000, 0), 'loan_out');
  assert.strictEqual(c('ריבית 3ט', 800, 0), 'interest');
  assert.strictEqual(c('העברה בנקאית', 7000, 0), 'withdrawal');
  assert.strictEqual(c('', 4000, 0), 'unclassified');
});

function ctxFor(rows, review) {
  const state = {
    company: 'בדיקה', preparer: 'x', years: [2025], rates: {}, accounts: {},
    settings: { vatOnDebit: true, grossIncludesVat: true, daysMethod: 'ram', extendToYearEnd: true },
    ledgers: [{ id: 1, name: 'l', group: 'בעל', type: 'shareholder', rows, issues: [], review: review || {} }],
  };
  return PL.buildContext(state);
}

test('ניתוח: יתרת חובה ממושכת, ללא הסכם, חשיפות וחלופות', () => {
  const rows = [
    { seq: 0, kind: 'opening', date: null, desc: 'יתרת פתיחה', debit: 50000, credit: 0, excluded: false },
    mk(1, D(2025, 2, 10), 'משיכה', 10000, 0),
    mk(2, D(2025, 6, 1), 'העברה', 6000, 0),
    mk(3, D(2025, 12, 20), 'החזר', 0, 8000),
    mk(4, D(2026, 1, 5), 'משיכה', 8000, 0),
  ];
  const ctx = ctxFor(rows, { loanAgreement: 'no', interestPaid: 'no' });
  const [{ a }] = K.analyzeAll(ctx);
  assert.strictEqual(a.monthsDebit, 12);
  assert.ok(a.indicators.some((i) => /הסכם הלוואה/.test(i.text) && i.sev === 'high'));
  assert.ok(a.indicators.some((i) => /ריבית רעיונית/.test(i.text)));
  assert.ok(a.indicators.some((i) => /עיטור/.test(i.text)), 'החזר סוף שנה + משיכה בינואר');
  // משיכות 10000 + 6000 פחות החזר 8000 = 8000 נטו
  assert.strictEqual(a.exposure.undocNet, 8000);
  assert.strictEqual(a.exposure.dividend.tax, 2400);
  const alts = K.alternatives(a);
  assert.strictEqual(alts.length, 4);
  assert.ok(K.documents(a).length >= 6);
  assert.ok(K.actions(a).length >= 3);
});

test('דגלים: משיכה גדולה, סכום עגול, כפילות ולא מסווג', () => {
  const rows = [
    mk(1, D(2025, 3, 1), '', 12000, 0),
    mk(2, D(2025, 3, 1), '', 12000, 0),
  ];
  const [{ a }] = K.analyzeAll(ctxFor(rows));
  const codes = a.rows[0].flags.map((f) => f.code);
  ['big', 'round', 'nodesc', 'dup', 'unclassified'].forEach((c) => assert.ok(codes.includes(c), c));
});

test('שינוי סיווג ידני משפיע על החשיפה', () => {
  const rows = [mk(1, D(2025, 3, 1), '', 12000, 0)];
  rows[0].catOverride = 'salary';
  const [{ a }] = K.analyzeAll(ctxFor(rows));
  assert.strictEqual(a.rows[0].cat, 'salary');
  assert.strictEqual(a.exposure.undocNet, 0);
});

test('הסכם הלוואה קיים מוציא הלוואות מהבסיס הלא מתועד', () => {
  const rows = [mk(1, D(2025, 3, 1), 'הלוואה לבעל מניות', 20000, 0)];
  const [{ a }] = K.analyzeAll(ctxFor(rows, { loanAgreement: 'yes' }));
  assert.strictEqual(a.exposure.undocNet, 0);
});
