const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const XLSX = require('../vendor/xlsx.full.min.js');
const ExcelJS = require('../vendor/exceljs.min.js');
const C = require('../src/lib/calc.js');
const P = require('../src/lib/parse.js');
const PL = require('../src/lib/pipeline.js');
const EI = require('../src/lib/export-interest.js');

const OUT = process.env.E2E_OUT || require('os').tmpdir();

function ledgerGrid() {
  const g = [['כרטסת: יובל כהן'], ['תאריך', 'אסמכתא', 'תיאור', 'חובה', 'זכות', 'יתרה']];
  let bal = -80156.19; // סימן: יתרה שלילית = חובה
  g.push(['', '', 'יתרת פתיחה', 80156.19, '', bal]);
  const add = (d, desc, deb, cred) => { bal += -(deb || 0) + (cred || 0); g.push([d, '', desc, deb || '', cred || '', Math.round(bal * 100) / 100]); };
  add('15/01/2024', 'משיכה', 8836.12, 0);
  add('30/01/2024', 'החזר', 0, 16000);
  add('10/02/2024', 'משיכה', 6944.78, 0);
  add('27/02/2024', 'החזר', 0, 15000);
  add('05/03/2024', 'משיכה', 8529.49, 0);
  add('30/03/2024', 'החזר', 0, 18000);
  add('31/12/2024', 'ריבית 3ט קיימת', 500, 0);
  return g;
}

function baseState(rows, issues) {
  return {
    company: 'חברה לדוגמה בע"מ', preparer: 'רו"ח בודק', years: [2024], rates: {},
    settings: { vatOnDebit: true, grossIncludesVat: true, daysMethod: 'ram', extendToYearEnd: true },
    accounts: {},
    ledgers: [{ id: 1, name: 'ledger.xlsx', group: 'יובל כהן', type: 'shareholder', rows, issues: issues || [] }],
  };
}

test('קובץ אקסל אמיתי נקרא, מחושב ומיוצא לקובץ עם נוסחאות תקינות', async () => {
  // כתיבת קובץ מקור וקריאתו דרך הספרייה שבכלי
  const ws = XLSX.utils.aoa_to_sheet(ledgerGrid());
  const wbSrc = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wbSrc, ws, 'כרטסת');
  const buf = XLSX.write(wbSrc, { type: 'buffer', bookType: 'xlsx' });
  const back = XLSX.read(buf, { type: 'buffer' });
  const grid = XLSX.utils.sheet_to_json(back.Sheets['כרטסת'], { header: 1, raw: true, defval: '' });

  const layout = P.detectLayout(grid);
  assert.ok(layout.detected);
  const parsed = P.parseLedger(grid, layout, { balNegIsDebit: true });
  const ctx = PL.buildContext(baseState(parsed.rows, parsed.issues));
  assert.strictEqual(ctx.blocked.length, 0);
  const yb = ctx.groups[0].years[0];
  assert.strictEqual(yb.opening, 80156.19);
  assert.strictEqual(yb.excludedRows.length, 1); // שורת הריבית הקיימת
  const m = yb.res.months;
  assert.strictEqual(C.round2(m[0].interestD), 454.0);
  assert.strictEqual(C.round2(m[1].interestD), 385.86);
  assert.strictEqual(C.round2(m[2].interestD), 392.32);
  assert.strictEqual(yb.recon.diffs.length, 0);

  const { wb } = EI.buildInterestWorkbook(ExcelJS, ctx);
  const file = path.join(OUT, 'e2e-interest.xlsx');
  fs.writeFileSync(file, Buffer.from(await wb.xlsx.writeBuffer()));
  assert.ok(fs.statSync(file).size > 5000);
  // RTL על כל הגיליונות
  const chk = new ExcelJS.Workbook();
  await chk.xlsx.load(fs.readFileSync(file));
  chk.eachSheet((s) => assert.strictEqual(s.views[0].rightToLeft, true, s.name));
  assert.ok(chk.worksheets.length >= 4);
});
