/* כלי עזר משותפים לייצוא אקסל (ExcelJS): סגנונות, שמות גיליונות, כותרות מימין לשמאל. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./calc.js'));
  else root.ExportCommon = factory(root.Calc);
})(typeof self !== 'undefined' ? self : this, function (Calc) {
  const FONT = 'Arial';
  const NUM = '#,##0.00;[Red]-#,##0.00;"-"';
  const NUM0 = '#,##0;[Red]-#,##0;"-"';
  const PCT = '0.00"%"';
  const COLORS = { head: 'FF1F3864', sub: 'FFD9E1F2', input: 'FFFFF2CC', total: 'FFE2EFDA', warn: 'FFFCE4D6', bad: 'FFF8CBAD' };
  const thin = { style: 'thin', color: { argb: 'FF999999' } };
  const BORDER = { top: thin, left: thin, bottom: thin, right: thin };

  function sheetName(base, used) {
    let n = String(base).replace(/[\[\]:*?\/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'גיליון';
    let k = 2;
    let cand = n;
    while (used.has(cand.toLowerCase())) {
      const suf = ' ' + k++;
      cand = n.slice(0, 31 - suf.length) + suf;
    }
    used.add(cand.toLowerCase());
    return cand;
  }

  function newSheet(wb, name, opts) {
    const ws = wb.addWorksheet(name, {
      views: [{ rightToLeft: true, showGridLines: false, state: opts && opts.freezeRow ? 'frozen' : 'normal', ySplit: (opts && opts.freezeRow) || 0 }],
      pageSetup: { orientation: (opts && opts.orientation) || 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
      properties: { defaultRowHeight: 18 },
    });
    ws.headerFooter.oddFooter = '&Rעמוד &P מתוך &N';
    return ws;
  }

  function style(cell, o) {
    o = o || {};
    cell.font = { name: FONT, size: o.size || 10, bold: !!o.bold, italic: !!o.italic, color: o.color ? { argb: o.color } : undefined };
    if (o.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: o.fill } };
    if (o.border) cell.border = BORDER;
    cell.alignment = { horizontal: o.align || 'right', vertical: 'middle', wrapText: !!o.wrap, readingOrder: 'rtl' };
    if (o.fmt) cell.numFmt = o.fmt;
  }

  /* בלוק כותרת אחיד: שם חברה, שם נייר העבודה, מי הכין ומתי. מחזיר את מספר השורה הבאה הפנויה. */
  function headerBlock(ws, ctx, title, extraLines, lastCol) {
    const put = (r, text, o) => {
      ws.mergeCells(r, 1, r, lastCol);
      const c = ws.getCell(r, 1);
      c.value = text;
      style(c, o);
    };
    put(1, ctx.company || '(שם חברה לא הוזן)', { size: 16, bold: true });
    put(2, title, { size: 13, bold: true, color: COLORS.head });
    put(3, 'הוכן על ידי: ' + (ctx.preparer || '(לא הוזן)') + '   |   תאריך הכנה: ' + ctx.createdLabel, { size: 10 });
    let r = 4;
    (extraLines || []).forEach((t) => { put(r++, t, { size: 10 }); });
    return r + 1;
  }

  function tableHeader(ws, r, labels, startCol) {
    labels.forEach((t, i) => {
      const c = ws.getCell(r, (startCol || 1) + i);
      c.value = t;
      style(c, { bold: true, color: 'FFFFFFFF', fill: COLORS.head, border: true, align: 'center', wrap: true });
    });
    ws.getRow(r).height = 30;
  }

  function sectionTitle(ws, r, text, lastCol) {
    ws.mergeCells(r, 1, r, lastCol);
    const c = ws.getCell(r, 1);
    c.value = text;
    style(c, { bold: true, size: 11, fill: COLORS.sub, border: true });
  }

  function setWidths(ws, widths) {
    widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  }

  function createdLabel(d) {
    d = d || new Date();
    return Calc.fmtDate(Calc.dayNum(d.getFullYear(), d.getMonth() + 1, d.getDate()));
  }

  return { FONT, NUM, NUM0, PCT, COLORS, BORDER, sheetName, newSheet, style, headerBlock, tableHeader, sectionTitle, setWidths, createdLabel };
});
