/* נייר עבודה: ניתוח כרטסת בעל מניות (בודק משיכות בעלים). מבנה לפי הסקיל:
 * תמונת מצב, טבלת תנועות קריטיות, חלופות סיווג, חשיפות מס, מסמכים מומלצים, פעולות תיקון. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./calc.js'), require('./export-common.js'), require('./classify.js'), require('./export-interest.js'));
  else root.ExportAnalysis = factory(root.Calc, root.ExportCommon, root.Classify, root.ExportInterest);
})(typeof self !== 'undefined' ? self : this, function (Calc, X, K, EI) {
  const LAST = 6;
  const YN = { yes: 'כן', no: 'לא', unknown: 'לא ידוע', na: 'לא רלוונטי', '': 'לא נענה', undefined: 'לא נענה' };
  const SEV = { high: ['גבוהה', X.COLORS.bad], medium: ['בינונית', X.COLORS.warn], low: ['נמוכה', X.COLORS.sub] };

  function wrapHeight(ws, r, texts, widths) {
    let lines = 1;
    texts.forEach((t, i) => {
      const w = widths[i] || 20;
      const l = String(t || '').split('\n').reduce((s, part) => s + Math.max(1, Math.ceil(part.length / Math.max(8, w * 1.05))), 0);
      lines = Math.max(lines, l);
    });
    ws.getRow(r).height = Math.max(18, lines * 14 + 4);
  }

  function writeAnalysisSheet(wb, used, ctx, item, single) {
    const { group, yb, a } = item;
    const name = X.sheetName(single ? 'ניתוח כרטסת בעל מניות' : 'ניתוח - ' + group.name + ' ' + yb.year, used);
    const ws = X.newSheet(wb, name);
    const W = [16, 38, 16, 16, 24, 50];
    X.setWidths(ws, W);
    let r = X.headerBlock(ws, ctx, 'ניתוח כרטסת בעל מניות, שנת ' + yb.year, [
      'צד קשור: ' + group.name + '   |   סוג: ' + group.typeLabel,
      'מקור הנתונים: ' + group.ledgers.join(' ; '),
    ], LAST);

    const kv = (label, value, o) => {
      ws.getCell(r, 1).value = label; ws.mergeCells(r, 1, r, 2); X.style(ws.getCell(r, 1), { border: true, bold: true });
      const c = ws.getCell(r, 3); c.value = value; X.style(c, { border: true, fmt: (o && o.fmt) || X.NUM, align: (o && o.align) || 'right', fill: o && o.fill, color: o && o.color, bold: o && o.bold });
      if (o && o.note) { ws.getCell(r, 4).value = o.note; ws.mergeCells(r, 4, r, LAST); X.style(ws.getCell(r, 4), { italic: true, size: 9, wrap: true }); }
      r++;
      return r - 1;
    };
    const side = (v) => (v > 0.5 ? ' (חובה)' : v < -0.5 ? ' (זכות)' : '');

    // 1. תמונת מצב
    X.sectionTitle(ws, r++, '1. תמונת מצב', LAST);
    kv('יתרת פתיחה', Calc.round2(a.opening), { note: side(a.opening) });
    kv('יתרת סגירה', Calc.round2(a.closing), { note: side(a.closing) });
    kv('שיא יתרת חובה בשנה', Calc.round2(a.peakD.value), { note: a.peakD.date ? 'בתאריך ' + Calc.fmtDate(a.peakD.date) : '' });
    kv('שיא יתרת זכות בשנה', Calc.round2(a.peakC.value), { note: a.peakC.date ? 'בתאריך ' + Calc.fmtDate(a.peakC.date) : '' });
    kv('חודשים בסוף החודש ביתרת חובה', a.monthsDebit, { fmt: '0' });
    kv('חודשים בסוף החודש ביתרת זכות', a.monthsCredit, { fmt: '0' });
    kv('יתרה יומית ממוצעת', Calc.round2(a.avgBalance));
    kv('סה"כ חובות בשנה', a.totalDebits);
    kv('סה"כ זכויות בשנה', a.totalCredits);
    kv('מספר תנועות', a.rows.length, { fmt: '0' });
    r++;
    X.sectionTitle(ws, r++, 'שאלות סקירה ותשובות', LAST);
    kv('קיים הסכם הלוואה כתוב?', YN[a.review.loanAgreement], { align: 'center', fmt: '@', fill: a.review.loanAgreement === 'yes' ? undefined : X.COLORS.warn });
    kv('שולמה ריבית על היתרה?', YN[a.review.interestPaid], { align: 'center', fmt: '@' });
    kv('בוצעו קיזוזים / החזרים / חלוקות?', YN[a.review.offsets], { align: 'center', fmt: '@' });
    kv('לבעל המניות שליטה בחברה?', YN[a.review.controlling], { align: 'center', fmt: '@' });
    kv('קיימת החלטה מתועדת על דיבידנד?', YN[a.review.dividendDecision], { align: 'center', fmt: '@' });
    r++;

    // אינדיקטורים
    X.sectionTitle(ws, r++, 'ממצאים ואינדיקטורים (אין בהם קביעה נחרצת, אלא נקודות לבירור)', LAST);
    if (!a.indicators.length) { ws.getCell(r, 1).value = 'לא זוהו אינדיקטורים חריגים לפי הנתונים שהוזנו.'; ws.mergeCells(r, 1, r, LAST); X.style(ws.getCell(r, 1), { italic: true }); r++; }
    a.indicators.forEach((i) => {
      ws.getCell(r, 1).value = 'רמה: ' + SEV[i.sev][0]; X.style(ws.getCell(r, 1), { border: true, bold: true, fill: SEV[i.sev][1], align: 'center' });
      ws.getCell(r, 2).value = i.text; ws.mergeCells(r, 2, r, LAST); X.style(ws.getCell(r, 2), { border: true, wrap: true });
      wrapHeight(ws, r, ['', i.text], [16, 130]);
      r++;
    });
    r++;

    // 2. סיווג
    X.sectionTitle(ws, r++, '2. פילוח תנועות לפי סיווג (הסיווג האוטומטי ניתן לשינוי בכלי)', LAST);
    X.tableHeader(ws, r, ['סיווג', '', 'מס\' תנועות', 'חובה', 'זכות', 'נטו (חובה פחות זכות)']);
    ws.mergeCells(r, 1, r, 2);
    r++;
    const catFirst = r;
    Object.keys(K.CATS).filter((k) => k !== 'opening' && a.byCat[k].count).forEach((k) => {
      const c = a.byCat[k];
      ws.getCell(r, 1).value = K.CATS[k]; ws.mergeCells(r, 1, r, 2); X.style(ws.getCell(r, 1), { border: true });
      ws.getCell(r, 3).value = c.count; X.style(ws.getCell(r, 3), { border: true, fmt: '0', align: 'center' });
      ws.getCell(r, 4).value = c.debit; X.style(ws.getCell(r, 4), { border: true, fmt: X.NUM });
      ws.getCell(r, 5).value = c.credit; X.style(ws.getCell(r, 5), { border: true, fmt: X.NUM });
      ws.getCell(r, 6).value = { formula: `D${r}-E${r}`, result: Calc.round2(c.debit - c.credit) }; X.style(ws.getCell(r, 6), { border: true, fmt: X.NUM });
      r++;
    });
    const catLast = r - 1;
    ws.getCell(r, 1).value = 'סה"כ'; ws.mergeCells(r, 1, r, 2);
    ['C', 'D', 'E', 'F'].forEach((col, i) => {
      const cell = ws.getCell(r, 3 + i);
      const res = i === 0 ? a.rows.length : i === 1 ? a.totalDebits : i === 2 ? a.totalCredits : Calc.round2(a.totalDebits - a.totalCredits);
      cell.value = catLast >= catFirst ? { formula: `SUM(${col}${catFirst}:${col}${catLast})`, result: res } : 0;
    });
    for (let c = 1; c <= 6; c++) X.style(ws.getCell(r, c), { bold: true, border: true, fill: X.COLORS.total, fmt: c === 3 ? '0' : X.NUM, align: c === 3 ? 'center' : 'right' });
    r += 2;

    // 3. תנועות קריטיות
    X.sectionTitle(ws, r++, '3. טבלת תנועות קריטיות (תנועות שסומנו בדגל)', LAST);
    X.tableHeader(ws, r++, ['תאריך', 'תיאור', 'חובה', 'זכות', 'סיווג', 'דגלים']);
    if (!a.flagged.length) { ws.getCell(r, 1).value = 'לא נמצאו תנועות עם דגלים.'; ws.mergeCells(r, 1, r, LAST); X.style(ws.getCell(r, 1), { italic: true }); r++; }
    a.flagged.slice(0, 200).forEach((t) => {
      const flags = t.flags.map((f) => f.text).join('; ');
      const vals = [Calc.fmtDate(t.date), t.desc, t.debit || null, t.credit || null, t.catLabel, flags];
      vals.forEach((v, i) => { const c = ws.getCell(r, i + 1); c.value = v; X.style(c, { border: true, fmt: i === 2 || i === 3 ? X.NUM : undefined, wrap: i === 1 || i === 5 }); });
      wrapHeight(ws, r, vals, W);
      r++;
    });
    r++;

    // 4. חלופות סיווג
    X.sectionTitle(ws, r++, '4. חלופות סיווג לתנועות שאינן מתועדות', LAST);
    X.tableHeader(ws, r, ['חלופה', '', 'יתרונות', '', 'חסרונות', 'חשיפה משוערת והוכחות נדרשות']);
    ws.mergeCells(r, 1, r, 2); ws.mergeCells(r, 3, r, 4);
    r++;
    K.alternatives(a).forEach((alt) => {
      ws.getCell(r, 1).value = alt.name; ws.mergeCells(r, 1, r, 2); X.style(ws.getCell(r, 1), { border: true, bold: true, wrap: true });
      ws.getCell(r, 3).value = alt.pros; ws.mergeCells(r, 3, r, 4); X.style(ws.getCell(r, 3), { border: true, wrap: true });
      ws.getCell(r, 5).value = alt.cons; X.style(ws.getCell(r, 5), { border: true, wrap: true });
      const last = 'חשיפה: ' + alt.risk + '\nהוכחות: ' + alt.evidence;
      ws.getCell(r, 6).value = last; X.style(ws.getCell(r, 6), { border: true, wrap: true });
      wrapHeight(ws, r, [alt.name, alt.pros, alt.cons, last], [32, 32, 24, 50]);
      r++;
    });
    r++;

    // 5. חשיפות
    X.sectionTitle(ws, r++, '5. חשיפות מס פוטנציאליות (אומדן להמחשה בלבד, תאים צהובים ניתנים לעדכון)', LAST);
    const e = a.exposure;
    const base = kv('בסיס לא מתועד (משיכות שלא סווגו נטו אחרי החזרים)', e.undocNet, { note: 'משיכה פרטית + לא מסווג + הלוואה ללא הסכם, פחות החזרים והפקדות' });
    const inputKv = (label, val) => { const rr = kv(label, val, { fmt: X.PCT, fill: X.COLORS.input, color: 'FF0000FF' }); return rr; };
    const rDiv = inputKv('שיעור מס דיבידנד (%)', e.dividend.rate);
    const rSal = inputKv('שיעור מס שולי על שכר (%)', e.salary.rate);
    const rEmp = inputKv('עלות מעסיק וביטוח לאומי נוספת (%)', e.salary.employer);
    r++;
    X.tableHeader(ws, r++, ['תרחיש', '', 'סכום בסיס', 'שיעור', 'חשיפה', 'הערה']);
    ws.mergeCells(r - 1, 1, r - 1, 2);
    const exLine = (label, baseF, rateF, resF, res, note) => {
      ws.getCell(r, 1).value = label; ws.mergeCells(r, 1, r, 2); X.style(ws.getCell(r, 1), { border: true, bold: true });
      ws.getCell(r, 3).value = baseF; X.style(ws.getCell(r, 3), { border: true, fmt: X.NUM });
      ws.getCell(r, 4).value = rateF; X.style(ws.getCell(r, 4), { border: true, fmt: X.PCT });
      ws.getCell(r, 5).value = resF === null ? res : { formula: resF, result: res }; X.style(ws.getCell(r, 5), { border: true, fmt: X.NUM0, bold: true, fill: X.COLORS.total });
      ws.getCell(r, 6).value = note; X.style(ws.getCell(r, 6), { border: true, wrap: true, size: 9 });
      wrapHeight(ws, r, [label, '', '', '', '', note], [16, 38, 16, 16, 24, 50]);
      r++;
    };
    exLine('הלוואה: ריבית רעיונית + מע"מ (על כל היתרה, בסיס: יתרה יומית ממוצעת)', null, null, null, e.loan.total, 'ריבית ללא מע"מ ' + Calc.round0(e.loan.net).toLocaleString('he-IL') + ' ומע"מ ' + Calc.round0(e.loan.vat).toLocaleString('he-IL') + ', לפי נייר העבודה הראשון');
    ws.getCell(r - 1, 3).value = Calc.round2(a.avgBalance);
    exLine('דיבידנד מוסווה: מס דיבידנד', { formula: `C${base}`, result: e.undocNet }, { formula: `C${rDiv}`, result: e.dividend.rate }, `ROUND(C${r}*D${r}/100,0)`, e.dividend.tax, 'לא כולל מס יסף, ריבית והצמדה על חוב מס, וקנסות');
    exLine('שכר: מס שולי + עלות מעסיק', { formula: `C${base}`, result: e.undocNet }, { formula: `C${rSal}+C${rEmp}`, result: e.salary.rate + e.salary.employer }, `ROUND(C${r}*D${r}/100,0)`, e.salary.tax, 'אומדן גס, ללא גילום ברוטו ובלי מדרגות מס');
    r++;

    // 6. מסמכים
    X.sectionTitle(ws, r++, '6. מסמכים מומלצים להכנה', LAST);
    K.documents(a).forEach((d, i) => { ws.getCell(r, 1).value = i + 1; X.style(ws.getCell(r, 1), { border: true, align: 'center' }); ws.getCell(r, 2).value = d; ws.mergeCells(r, 2, r, LAST); X.style(ws.getCell(r, 2), { border: true, wrap: true }); r++; });
    r++;
    X.sectionTitle(ws, r++, '7. פעולות תיקון מוצעות', LAST);
    K.actions(a).forEach((d, i) => { ws.getCell(r, 1).value = i + 1; X.style(ws.getCell(r, 1), { border: true, align: 'center' }); ws.getCell(r, 2).value = d; ws.mergeCells(r, 2, r, LAST); X.style(ws.getCell(r, 2), { border: true, wrap: true }); wrapHeight(ws, r, ['', d], [16, 130]); r++; });
    r++;
    const note = ws.getCell(r, 1);
    note.value = 'הערה: הניתוח הוא כלי עזר לסקירה. הסיווג האוטומטי מבוסס על מילות מפתח בתיאור התנועה, והחשיפות הן אומדנים להמחשה. הקביעה הסופית באחריות הסוקר, לאחר בירור העובדות והמסמכים, ואין בו קביעה משפטית.';
    ws.mergeCells(r, 1, r, LAST); X.style(note, { italic: true, size: 9, wrap: true }); ws.getRow(r).height = 32;
    return ws;
  }

  function addAnalysisSheets(wb, used, ctx, analyses) {
    const single = analyses.length === 1;
    analyses.forEach((it) => writeAnalysisSheet(wb, used, ctx, it, single));
    // תנועות עם סיווג ודגלים
    analyses.forEach((it) => it.a.rows.forEach((r) => { r.flagText = r.flags.map((f) => f.text).join('; '); }));
    const ctxRows = { groups: ctx.groups, company: ctx.company, preparer: ctx.preparer, createdLabel: ctx.createdLabel };
    EI.writeTransactionsSheet(wb, used, ctxRows, true);
  }

  function buildAnalysisWorkbook(ExcelJS, ctx, analyses) {
    const wb = new ExcelJS.Workbook();
    wb.creator = ctx.preparer || 'כלי בודק משיכות בעלים';
    wb.created = new Date();
    wb.calcProperties = { fullCalcOnLoad: true };
    const used = new Set();
    addAnalysisSheets(wb, used, ctx, analyses);
    return { wb, used };
  }

  return { buildAnalysisWorkbook, addAnalysisSheets, writeAnalysisSheet };
});
