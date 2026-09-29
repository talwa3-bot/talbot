const test = require('node:test');
const assert = require('node:assert');
const C = require('../src/lib/calc.js');

const D = (y, m, d) => C.dayNum(y, m, d);

test('הדוגמה מהסקיל: ינואר-מרץ 2024, יתרת חובה, 6.91%', () => {
  const rows = [
    { date: D(2024, 1, 15), debit: 8836.12, credit: 0 },
    { date: D(2024, 1, 30), debit: 0, credit: 16000 },
    { date: D(2024, 2, 10), debit: 6944.78, credit: 0 },
    { date: D(2024, 2, 27), debit: 0, credit: 15000 },
    { date: D(2024, 3, 5), debit: 8529.49, credit: 0 },
    { date: D(2024, 3, 30), debit: 0, credit: 18000 },
  ];
  const res = C.computeYear(rows, {
    year: 2024, opening: 80156.19, rates: { s3t: 6.91, s3y: 5.18, vat: 17 },
    debitSection: 's3t', creditSection: 's3y',
  });
  const [jan, feb, mar] = res.months;
  assert.strictEqual(jan.days, 30);
  assert.strictEqual(feb.days, 28);
  assert.strictEqual(mar.days, 32);
  assert.strictEqual(jan.close, 72992.31);
  assert.strictEqual(feb.close, 64937.09);
  assert.strictEqual(mar.close, 55466.58);
  assert.strictEqual(C.round2(jan.interestD), 454.0);
  assert.strictEqual(C.round2(feb.interestD), 385.86);
  assert.strictEqual(C.round2(mar.interestD), 392.32);
});

test('פירוק מע"מ בשיטת רם: 2,558.63 כולל מע"מ => 2,187 + 372 = 2,559', () => {
  // סינתטי: יתרה שנתית קבועה שנותנת ריבית מצטברת ידועה
  const rows = [{ date: D(2024, 12, 31), debit: 0, credit: 0 }];
  const res = C.computeYear(rows, { year: 2024, opening: 100000, rates: { s3t: 6.91, vat: 17 }, debitSection: 's3t' });
  assert.strictEqual(res.totals.days, 366);
  assert.strictEqual(res.totals.totalD, Math.round(res.totals.grossD));
  assert.strictEqual(res.totals.netD + res.totals.vatD, res.totals.totalD);
  // בדיקה ישירה של הפירוק
  const g = 2558.63;
  assert.strictEqual(Math.round(g / 1.17), 2187);
  assert.strictEqual(Math.round(g) - Math.round(g / 1.17), 372);
});

test('סכום הימים בשנה מלאה שווה 365/366', () => {
  const r25 = C.computeYear([], { year: 2025, opening: 1000, rates: { s3t: 6.69, vat: 18 }, debitSection: 's3t' });
  assert.strictEqual(r25.totals.days, 365);
  // ריבית שנתית על יתרה קבועה = יתרה * שיעור
  assert.strictEqual(C.round2(r25.totals.grossD), 66.9);
});

test('יתרת זכות: 3(י) והצמדה, בלי מע"מ', () => {
  const r = C.computeYear([], { year: 2025, opening: -50000, rates: { s3y: 5.02, cpi: 3, vat: 18 }, debitSection: 's3t', creditSection: 's3y' });
  assert.strictEqual(r.totals.totalD, 0);
  assert.strictEqual(r.totals.interestC, 2510);
  assert.strictEqual(r.totals.linkage, 1500);
});

test('deriveOpening: צבירת תנועות לפני השנה ושורת פתיחה', () => {
  const rows = [
    { kind: 'opening', date: null, debit: 1000, credit: 0 },
    { date: D(2024, 5, 1), debit: 500, credit: 0 },
    { date: D(2024, 6, 1), debit: 0, credit: 200 },
    { date: D(2025, 2, 1), debit: 999, credit: 0 },
  ];
  const o = C.deriveOpening(rows, 2025);
  assert.strictEqual(o.value, 1300);
  assert.ok(o.found);
});

test('שורות מוחרגות לא נספרות', () => {
  const rows = [{ date: D(2025, 3, 1), debit: 1000, credit: 0, excluded: true }];
  const r = C.computeYear(rows, { year: 2025, opening: 0, rates: {}, debitSection: 's3t' });
  assert.strictEqual(r.txCount, 0);
});

test('השוואת יתרה יומית: יתרה קבועה נותנת אותה ריבית שנתית', () => {
  const d = C.dailyBalanceInterest([], { year: 2025, opening: 10000, rates: { s3t: 6.69 }, debitSection: 's3t' });
  assert.strictEqual(d.interestD, 669);
});
