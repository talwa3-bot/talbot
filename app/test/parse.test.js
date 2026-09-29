const test = require('node:test');
const assert = require('node:assert');
const P = require('../src/lib/parse.js');
const C = require('../src/lib/calc.js');

test('parseNum: סוגריים, מינוס בסוף, פסיקים', () => {
  assert.strictEqual(P.parseNum('(1,234.50)'), -1234.5);
  assert.strictEqual(P.parseNum('1,234.50-'), -1234.5);
  assert.strictEqual(P.parseNum('₪ 500'), 500);
  assert.strictEqual(P.parseNum(''), null);
  assert.strictEqual(P.parseNum('abc'), null);
});

test('parseDate: פורמטים', () => {
  assert.strictEqual(P.parseDate('05/03/2025'), C.dayNum(2025, 3, 5));
  assert.strictEqual(P.parseDate('5.3.25'), C.dayNum(2025, 3, 5));
  assert.strictEqual(P.parseDate(45721), C.dayNum(2025, 3, 5)); // מספר סידורי
  assert.strictEqual(P.parseDate('לא תאריך'), null);
});

test('כותרות חובה/זכות: זיהוי ופענוח', () => {
  const grid = [
    ['כרטסת בעל מניות'],
    ['תאריך', 'אסמכתא', 'תיאור', 'חובה', 'זכות', 'יתרה'],
    ['', '', 'יתרת פתיחה', 1000, '', -1000],
    ['01/02/2025', '11', 'משיכה', 500, '', -1500],
    ['10/02/2025', '12', 'החזר', '', 300, -1200],
    ['', '', 'סה"כ', 500, 300, ''],
  ];
  const m = P.detectLayout(grid);
  assert.ok(m.detected);
  assert.strictEqual(m.headerRow, 1);
  const { rows } = P.parseLedger(grid, m, { balNegIsDebit: true });
  assert.strictEqual(rows.length, 3);
  assert.strictEqual(rows[0].kind, 'opening');
  assert.strictEqual(rows[0].debit, 1000);
  assert.strictEqual(rows[2].credit, 300);
  assert.strictEqual(P.reconcile(rows).diffs.length, 0);
});

test('עמודת סכום ויתרה בלבד (K,M,N,O): קוטביות מזוהה', () => {
  const row = (d, desc, amt, bal) => { const r = new Array(15).fill(''); r[10] = d; r[12] = desc; r[13] = amt; r[14] = bal; return r; };
  const grid = [
    row('01/01/2025', 'יתרת פתיחה', '', -1000),
    row('01/02/2025', 'משיכה', -500, -1500), // יתרה שלילית = חובה, יתרה יורדת = חובה מתווסף
    row('10/02/2025', 'החזר', 300, -1200),
  ];
  const m = P.detectLayout(grid);
  assert.ok(!m.detected);
  const { rows } = P.parseLedger(grid, m, { balNegIsDebit: true });
  assert.strictEqual(rows[0].debit, 1000);
  assert.strictEqual(rows[1].debit, 500);
  assert.strictEqual(rows[2].credit, 300);
  assert.strictEqual(P.reconcile(rows).diffs.length, 0);
});

test('שורות ריבית קיימת מוחרגות אוטומטית', () => {
  const grid = [
    ['תאריך', 'תיאור', 'חובה', 'זכות'],
    ['31/12/2024', 'ריבית 3ט 2024', 800, ''],
    ['31/12/2024', 'משיכה', 100, ''],
  ];
  const m = P.detectLayout(grid);
  const { rows } = P.parseLedger(grid, m, {});
  assert.strictEqual(rows[0].excluded, true);
  assert.strictEqual(rows[1].excluded, false);
});
