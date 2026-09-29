/* נייר עבודה: ריבית רעיונית 3(ט) / 3(י) / 3(ט1), מותאם לשיטת רם ניהול פלוס.
 * ctx: { company, preparer, createdLabel, accounts:{...}, groups:[ {name, typeLabel, years:[yearBlock], rows, ledgers} ] }
 * yearBlock: { year, opening, openingSource, res, cmp, settings, rates, excludedRows, extClosing } */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./calc.js'), require('./export-common.js'));
  else root.ExportInterest = factory(root.Calc, root.ExportCommon);
})(typeof self !== 'undefined' ? self : this, function (Calc, X) {
  const MONTHS_HE = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
  const SECTION_LABEL = { s3t: '3(ט)', s3t1: '3(ט1)', s3y: '3(י)' };

  function journalEntries(group, yb, accounts) {
    const t = yb.res.totals;
    const nm = group.name;
    const shAcc = (accounts.shareholder || 'בעלי מניות') + ' - ' + nm;
    const entries = [];
    const dl = t.debitKey ? SECTION_LABEL[t.debitKey] : '';
    if (t.debitKey && t.netD > 0) {
      entries.push({ dr: shAcc, cr: (accounts.incomeD || 'הכנסות מימון - ריבית ') + dl, amount: t.netD, note: 'ריבית רעיונית ' + dl + ' על יתרת חובה, שנת ' + yb.year });
      if (t.vatD > 0) entries.push({ dr: shAcc, cr: accounts.vat || 'מע"מ עסקאות', amount: t.vatD, note: 'מע"מ ' + t.vatRate + '% על ריבית ' + dl });
    }
    if (t.creditKey && yb.settings.bookCreditInterest && t.interestC > 0) {
      entries.push({ dr: accounts.expenseC || 'הוצאות מימון - ריבית 3(י)', cr: shAcc, amount: t.interestC, note: 'ריבית 3(י) על יתרת זכות, שנת ' + yb.year });
    }
    if (t.creditKey && t.linkage > 0) {
      entries.push({ dr: accounts.linkage || 'הוצאות מימון - הפרשי הצמדה', cr: shAcc, amount: t.linkage, note: 'הפרשי הצמדה 3(י), שנת ' + yb.year });
    }
    return entries;
  }

  function writeInterestSheet(wb, used, ctx, group, yb) {
    const name = X.sheetName('ריבית - ' + group.name + ' ' + yb.year, used);
    const ws = X.newSheet(wb, name);
    const t = yb.res.totals;
    const dl = t.debitKey ? SECTION_LABEL[t.debitKey] : '3(ט)';
    const LAST = 11;
    X.setWidths(ws, [26, 16, 15, 15, 16, 9, 12, 10, 16, 16, 15]);
    let r = X.headerBlock(ws, ctx, 'נייר עבודה: ריבית רעיונית לפי סעיפים 3(ט) / 3(י), שנת מס ' + yb.year, [
      'צד קשור: ' + group.name + '   |   סוג: ' + group.typeLabel,
      'מקור הנתונים: ' + (group.ledgers || []).join(' ; '),
    ], LAST);

    // פרמטרים
    X.sectionTitle(ws, r++, 'פרמטרי חישוב (תאים צהובים ניתנים לעדכון, החישוב מתעדכן אוטומטית)', LAST);
    const P = {};
    const param = (key, label, value, fmt, input) => {
      const a = ws.getCell(r, 1);
      a.value = label;
      X.style(a, { border: true, bold: true });
      const b = ws.getCell(r, 2);
      b.value = value;
      X.style(b, { border: true, fmt, align: 'center', fill: input ? X.COLORS.input : undefined, color: input ? 'FF0000FF' : undefined });
      P[key] = '$B$' + r;
      r++;
    };
    param('rateD', 'שיעור ריבית יתרת חובה ' + dl + ' (%)', t.rateD, X.PCT, true);
    param('rateC', 'שיעור ריבית יתרת זכות 3(י) (%)', t.rateC, X.PCT, true);
    param('vat', 'שיעור מע"מ (%)', t.vatRate, X.PCT, true);
    param('diy', 'ימים בשנה', t.diy, '0', true);
    param('cpi', 'עליית מדד שנתית להצמדה 3(י) (%)', t.cpi, X.PCT, true);
    const textParam = (label, v) => {
      const a = ws.getCell(r, 1); a.value = label; X.style(a, { border: true, bold: true });
      const b = ws.getCell(r, 2); b.value = v; X.style(b, { border: true, align: 'center' });
      ws.mergeCells(r, 2, r, 4);
      r++;
    };
    textParam('שיטת ספירת ימים', yb.settings.daysMethod === 'calendar' ? 'ימי לוח בכל חודש' : 'מתנועה אחרונה בחודש קודם עד תנועה אחרונה בחודש (שיטת רם)');
    textParam('יתרת פתיחה', Calc.round2(yb.opening).toLocaleString('he-IL') + ' (' + (yb.opening >= 0 ? 'חובה' : 'זכות') + ') - ' + yb.openingSource);
    r++;

    // טבלה
    const heads = ['חודש', 'יתרת פתיחה לחישוב (מעוגלת)', 'חובה', 'זכות', 'יתרת סגירה', 'ימים', 'סוג יתרה', 'שיעור %', 'ריבית ' + dl, 'ריבית 3(י)', 'הצמדה 3(י)'];
    X.tableHeader(ws, r, heads);
    const hdrRow = r;
    r++;
    const openRow = r;
    const cellFmt = (c, o) => X.style(c, Object.assign({ border: true, fmt: X.NUM }, o));
    ws.getCell(openRow, 1).value = 'יתרת פתיחה';
    X.style(ws.getCell(openRow, 1), { bold: true, border: true, fill: X.COLORS.sub });
    ws.getCell(openRow, 2).value = null; cellFmt(ws.getCell(openRow, 2), {});
    ws.getCell(openRow, 3).value = yb.opening > 0 ? Calc.round2(yb.opening) : 0; cellFmt(ws.getCell(openRow, 3), { bold: true });
    ws.getCell(openRow, 4).value = yb.opening < 0 ? Calc.round2(-yb.opening) : 0; cellFmt(ws.getCell(openRow, 4), { bold: true });
    ws.getCell(openRow, 5).value = { formula: `C${openRow}-D${openRow}`, result: Calc.round2(yb.opening) }; cellFmt(ws.getCell(openRow, 5), { bold: true });
    for (let c = 6; c <= LAST; c++) X.style(ws.getCell(openRow, c), { border: true });
    r++;
    const first = r;
    yb.res.months.forEach((m, i) => {
      const row = r + i;
      const prev = row - 1;
      const A = ws.getCell(row, 1); A.value = MONTHS_HE[m.month - 1] + ' ' + yb.year; X.style(A, { border: true });
      const B = ws.getCell(row, 2); B.value = { formula: `ROUND(E${prev},0)`, result: m.base }; cellFmt(B, {});
      const Cc = ws.getCell(row, 3); Cc.value = m.debit; cellFmt(Cc, {});
      const D = ws.getCell(row, 4); D.value = m.credit; cellFmt(D, {});
      const E = ws.getCell(row, 5); E.value = { formula: `E${prev}+C${row}-D${row}`, result: m.close }; cellFmt(E, {});
      const F = ws.getCell(row, 6); F.value = m.days; cellFmt(F, { fmt: '0', align: 'center', fill: X.COLORS.input, color: 'FF0000FF' });
      const G = ws.getCell(row, 7); G.value = { formula: `IF(B${row}>0,"חובה",IF(B${row}<0,"זכות","-"))`, result: m.side === 'D' ? 'חובה' : m.side === 'C' ? 'זכות' : '-' }; cellFmt(G, { fmt: '@', align: 'center' });
      const H = ws.getCell(row, 8); H.value = { formula: `IF(B${row}>0,${P.rateD},IF(B${row}<0,${P.rateC},0))`, result: m.rate }; cellFmt(H, { fmt: X.PCT, align: 'center' });
      const I = ws.getCell(row, 9); I.value = { formula: `IF(B${row}>0,B${row}*H${row}/100/${P.diy}*F${row},0)`, result: m.interestD }; cellFmt(I, {});
      const J = ws.getCell(row, 10); J.value = { formula: `IF(B${row}<0,-B${row}*H${row}/100/${P.diy}*F${row},0)`, result: m.interestC }; cellFmt(J, {});
      const K = ws.getCell(row, 11); K.value = { formula: `IF(B${row}<0,-B${row}*${P.cpi}/100/${P.diy}*F${row},0)`, result: m.linkage }; cellFmt(K, {});
    });
    const last = r + 11;
    r = last + 1;
    const totRow = r;
    const sumCol = (col, from, to, result) => ({ formula: `SUM(${col}${from}:${col}${to})`, result });
    ws.getCell(totRow, 1).value = 'סה"כ (כולל יתרת פתיחה)';
    X.style(ws.getCell(totRow, 1), { bold: true, border: true, fill: X.COLORS.total });
    ws.getCell(totRow, 2).value = null;
    ws.getCell(totRow, 3).value = sumCol('C', openRow, last, Calc.round2(t.debit + (yb.opening > 0 ? yb.opening : 0)));
    ws.getCell(totRow, 4).value = sumCol('D', openRow, last, Calc.round2(t.credit + (yb.opening < 0 ? -yb.opening : 0)));
    ws.getCell(totRow, 5).value = { formula: `C${totRow}-D${totRow}`, result: t.closing };
    ws.getCell(totRow, 6).value = sumCol('F', first, last, t.days);
    ws.getCell(totRow, 9).value = sumCol('I', first, last, t.grossD);
    ws.getCell(totRow, 10).value = sumCol('J', first, last, t.interestCRaw);
    ws.getCell(totRow, 11).value = sumCol('K', first, last, t.linkageRaw);
    for (let c = 2; c <= LAST; c++) {
      X.style(ws.getCell(totRow, c), { bold: true, border: true, fill: X.COLORS.total, fmt: c === 6 ? '0' : X.NUM, align: c === 6 ? 'center' : 'right' });
    }
    r += 2;

    // סיכום
    X.sectionTitle(ws, r++, 'סיכום ריבית ' + dl + ' על יתרת חובה', LAST);
    const line = (label, value, o) => {
      const a = ws.getCell(r, 1); a.value = label; X.style(a, { border: true, bold: !!(o && o.bold) });
      ws.mergeCells(r, 1, r, 2);
      const b = ws.getCell(r, 3); b.value = value; X.style(b, { border: true, fmt: (o && o.fmt) || X.NUM0, bold: !!(o && o.bold), fill: o && o.fill });
      if (o && o.note) { const n = ws.getCell(r, 4); n.value = o.note; X.style(n, { italic: true, size: 9 }); ws.mergeCells(r, 4, r, LAST); }
      r++;
      return r - 1;
    };
    const gross = `I${totRow}`;
    let rGross, rNet, rVat, rTot;
    if (!t.debitKey) {
      line('לא נבחר סעיף לחיוב יתרת חובה', 0);
    } else if (yb.settings.vatOnDebit === false) {
      rGross = line('ריבית מחושבת ' + dl + ' (ללא מע"מ)', { formula: gross, result: t.grossD }, { fmt: X.NUM });
      rNet = line('ריבית ' + dl + ' מעוגלת', { formula: `ROUND(${gross},0)`, result: t.netD }, { bold: true, fill: X.COLORS.total });
      line('מע"מ', 0, { note: 'מע"מ לא חל / לא סומן עבור סעיף זה' });
    } else if (yb.settings.grossIncludesVat !== false) {
      rGross = line('ריבית מצטברת (כולל מע"מ, כפי שרם ניהול מחשב)', { formula: gross, result: t.grossD }, { fmt: X.NUM, note: 'רם ניהול מחשב את הריבית התקופתית כולל מע"מ ומפרק בסוף' });
      rNet = line('ריבית ' + dl + ' ללא מע"מ', { formula: `ROUND(${gross}/(1+${P.vat}/100),0)`, result: t.netD }, { bold: true, fill: X.COLORS.total });
      rTot = line('סה"כ כולל מע"מ', { formula: `ROUND(${gross},0)`, result: t.totalD }, {});
      rVat = line('מע"מ (הפרש)', { formula: `C${rTot}-C${rNet}`, result: t.vatD }, { bold: true });
    } else {
      rGross = line('ריבית מחושבת ' + dl + ' (ללא מע"מ)', { formula: gross, result: t.grossD }, { fmt: X.NUM });
      rNet = line('ריבית ' + dl + ' מעוגלת', { formula: `ROUND(${gross},0)`, result: t.netD }, { bold: true, fill: X.COLORS.total });
      rVat = line('מע"מ', { formula: `ROUND(${gross}*${P.vat}/100,0)`, result: t.vatD }, { bold: true });
      line('סה"כ כולל מע"מ', { formula: `C${rNet}+C${rVat}`, result: t.totalD }, {});
    }
    r++;
    X.sectionTitle(ws, r++, 'סיכום יתרת זכות 3(י)', LAST);
    line('ריבית מינימלית 3(י) (מחושבת)', { formula: `ROUND(J${totRow},0)`, result: t.interestC }, {});
    line('הפרשי הצמדה (לפי מדד שנתי שהוזן)', { formula: `ROUND(K${totRow},0)`, result: t.linkage }, { bold: true, fill: X.COLORS.total, note: t.cpi ? '' : 'לא הוזן מדד: יש להזין עליית מדד בפרמטרים' });
    r++;

    // פקודות יומן
    const entries = journalEntries(group, yb, ctx.accounts || {});
    X.sectionTitle(ws, r++, 'פקודת יומן מוצעת, תאריך 31/12/' + yb.year, LAST);
    X.tableHeader(ws, r, ['מס\'', 'חשבון חובה', '', 'חשבון זכות', '', 'סכום', 'פרטים']);
    ws.mergeCells(r, 2, r, 3); ws.mergeCells(r, 4, r, 5); ws.mergeCells(r, 7, r, LAST);
    r++;
    if (!entries.length) {
      const c = ws.getCell(r, 1); c.value = 'אין פקודות יומן לשנה זו'; X.style(c, { italic: true }); ws.mergeCells(r, 1, r, LAST); r++;
    }
    entries.forEach((e, i) => {
      ws.getCell(r, 1).value = i + 1; X.style(ws.getCell(r, 1), { border: true, align: 'center' });
      ws.getCell(r, 2).value = e.dr; ws.mergeCells(r, 2, r, 3); X.style(ws.getCell(r, 2), { border: true });
      ws.getCell(r, 4).value = e.cr; ws.mergeCells(r, 4, r, 5); X.style(ws.getCell(r, 4), { border: true });
      ws.getCell(r, 6).value = e.amount; X.style(ws.getCell(r, 6), { border: true, fmt: X.NUM0 });
      ws.getCell(r, 7).value = e.note; ws.mergeCells(r, 7, r, LAST); X.style(ws.getCell(r, 7), { border: true });
      r++;
    });
    r++;
    const note = ws.getCell(r, 1);
    note.value = 'הערה: הנייר מחושב על יתרת פתיחה חודשית מעוגלת לשקל, בשיטת רם ניהול פלוס. השיעורים והמע"מ נטענו מטבלת השיעורים בכלי ויש לאמתם מול הפרסום הרשמי של רשות המסים.';
    ws.mergeCells(r, 1, r, LAST);
    X.style(note, { italic: true, size: 9, wrap: true });
    ws.getRow(r).height = 30;
    ws.views = [{ rightToLeft: true, showGridLines: false, state: 'frozen', ySplit: hdrRow }];
    return { name, entries };
  }

  function writeJournalSheet(wb, used, ctx, all) {
    const ws = X.newSheet(wb, X.sheetName('פקודות יומן', used), {});
    X.setWidths(ws, [8, 34, 34, 14, 50]);
    let r = X.headerBlock(ws, ctx, 'פקודות יומן: ריבית רעיונית 3(ט) / 3(י)', [], 5);
    X.tableHeader(ws, r++, ['מס\'', 'חשבון חובה', 'חשבון זכות', 'סכום', 'פרטים']);
    let n = 1;
    let total = 0;
    all.forEach((e) => {
      ws.getCell(r, 1).value = n++; ws.getCell(r, 2).value = e.dr; ws.getCell(r, 3).value = e.cr; ws.getCell(r, 4).value = e.amount; ws.getCell(r, 5).value = e.note;
      for (let c = 1; c <= 5; c++) X.style(ws.getCell(r, c), { border: true, fmt: c === 4 ? X.NUM0 : undefined, align: c === 1 ? 'center' : 'right' });
      total += e.amount;
      r++;
    });
    ws.getCell(r, 1).value = 'סה"כ';
    ws.mergeCells(r, 1, r, 3);
    ws.getCell(r, 4).value = { formula: `SUM(D${r - all.length}:D${r - 1})`, result: total };
    X.style(ws.getCell(r, 1), { bold: true, border: true, fill: X.COLORS.total });
    X.style(ws.getCell(r, 4), { bold: true, border: true, fill: X.COLORS.total, fmt: X.NUM0 });
    return ws;
  }

  function writeControlsSheet(wb, used, ctx) {
    const ws = X.newSheet(wb, X.sheetName('בקרות', used), {});
    X.setWidths(ws, [30, 8, 18, 18, 18, 18, 18, 40]);
    let r = X.headerBlock(ws, ctx, 'בקרות ותאימות לחישוב הריבית', [], 8);
    X.tableHeader(ws, r++, ['צד קשור', 'שנה', 'ימים שנספרו (צ"ל 365/366)', 'התאמת יתרת כרטסת (מס\' סטיות)', 'ריבית 3(ט) לפי רם', 'ריבית 3(ט) לפי יתרה יומית', 'הפרש בין השיטות', 'הערות']);
    for (const g of ctx.groups) {
      for (const yb of g.years) {
        const t = yb.res.totals;
        const diff = Calc.round2(t.grossD - yb.cmp.interestD);
        const vals = [g.name, yb.year, t.days, yb.recon.diffs.length, t.grossD, yb.cmp.interestD, diff];
        vals.forEach((v, i) => {
          const c = ws.getCell(r, i + 1); c.value = v;
          X.style(c, { border: true, fmt: i >= 4 ? X.NUM : undefined, align: i === 0 ? 'right' : 'center' });
        });
        const notes = [];
        if (t.days !== t.diy) notes.push('סה"כ ימים שונה מימי השנה');
        if (yb.recon.diffs.length) notes.push('יתרה בקובץ לא תואמת לתנועות');
        if (yb.excludedRows.length) notes.push(yb.excludedRows.length + ' שורות ריבית קיימת הוחרגו (סכום ' + Calc.round2(yb.excludedNet).toLocaleString('he-IL') + ')');
        if (!yb.openingFound) notes.push('יתרת פתיחה הוזנה ידנית');
        if (yb.extClosing != null) notes.push('יתרת סגירה בכרטסת ' + yb.extClosing.toLocaleString('he-IL') + ' מול מחושבת ' + Calc.round2(t.closing + yb.excludedNet).toLocaleString('he-IL'));
        const n = ws.getCell(r, 8); n.value = notes.join(' ; ') || 'תקין'; X.style(n, { border: true, wrap: true, fill: notes.length ? X.COLORS.warn : undefined });
        r++;
      }
    }
    r += 1;
    const issues = [];
    ctx.groups.forEach((g) => (g.issues || []).forEach((i) => issues.push([g.name, i])));
    if (issues.length) {
      X.sectionTitle(ws, r++, 'שורות שדולגו בקריאת הקובץ', 8);
      issues.forEach(([g, i]) => {
        ws.getCell(r, 1).value = g; ws.getCell(r, 2).value = 'שורה ' + i.row; ws.getCell(r, 3).value = i.msg;
        ws.mergeCells(r, 3, r, 8);
        X.style(ws.getCell(r, 1), { border: true }); X.style(ws.getCell(r, 2), { border: true }); X.style(ws.getCell(r, 3), { border: true });
        r++;
      });
    }
    return ws;
  }

  function writeTransactionsSheet(wb, used, ctx, withClass) {
    const ws = X.newSheet(wb, X.sheetName('תנועות', used), { freezeRow: 6 });
    const cols = withClass ? 10 : 8;
    X.setWidths(ws, withClass ? [26, 10, 12, 40, 14, 14, 20, 18, 12, 30] : [26, 10, 12, 40, 14, 14, 14, 24]);
    let r = X.headerBlock(ws, ctx, 'תנועות הכרטסת כפי שנקראו', [], cols);
    const heads = withClass ? ['צד קשור', 'שורה בקובץ', 'תאריך', 'תיאור', 'חובה', 'זכות', 'סיווג', 'מקור', 'הוחרג', 'הערה'] : ['צד קשור', 'שורה בקובץ', 'תאריך', 'תיאור', 'חובה', 'זכות', 'הוחרג מהחישוב', 'מקור'];
    X.tableHeader(ws, r, heads);
    ws.views = [{ rightToLeft: true, showGridLines: false, state: 'frozen', ySplit: r }];
    r++;
    for (const g of ctx.groups) {
      for (const row of g.rows) {
        const base = [g.name, row.srcRow, Calc.fmtDate(row.date), row.desc, row.debit, row.credit];
        const tail = withClass ? [row.catLabel || '', row.srcName || '', row.excluded ? 'כן' : '', row.flagText || ''] : [row.excluded ? 'כן' : '', row.srcName || ''];
        base.concat(tail).forEach((v, i) => {
          const c = ws.getCell(r, i + 1); c.value = v === 0 ? null : v;
          X.style(c, { border: true, fmt: i === 4 || i === 5 ? X.NUM : undefined, fill: row.excluded ? X.COLORS.warn : undefined, wrap: i === 3 });
        });
        r++;
      }
    }
    return ws;
  }

  function buildInterestWorkbook(ExcelJS, ctx, opts) {
    opts = opts || {};
    const wb = new ExcelJS.Workbook();
    wb.creator = ctx.preparer || 'כלי ריבית רעיונית';
    wb.created = new Date();
    wb.properties.date1904 = false;
    wb.calcProperties = { fullCalcOnLoad: true };
    const used = new Set();
    const allEntries = [];
    for (const g of ctx.groups) {
      for (const yb of g.years) {
        const res = writeInterestSheet(wb, used, ctx, g, yb);
        res.entries.forEach((e) => allEntries.push(e));
      }
    }
    writeJournalSheet(wb, used, ctx, allEntries);
    writeControlsSheet(wb, used, ctx);
    writeTransactionsSheet(wb, used, ctx, false);
    return { wb, used };
  }

  return { buildInterestWorkbook, writeInterestSheet, writeJournalSheet, writeControlsSheet, writeTransactionsSheet, journalEntries, SECTION_LABEL };
});
