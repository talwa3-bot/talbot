/* קריאת כרטסת (מערך דו-ממדי מקובץ אקסל) לשורות תנועה אחידות.
 * מוסכמת סימנים פנימית: debit מגדיל יתרת חובה (בעל המניות חייב לחברה). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./calc.js'));
  else root.Parse = factory(root.Calc);
})(typeof self !== 'undefined' ? self : this, function (Calc) {
  const HEB_MONTHS = {};

  function parseNum(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    let s = String(v).trim();
    if (!s) return null;
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    if (/-$/.test(s)) { neg = true; s = s.slice(0, -1); }
    if (/^-/.test(s)) { neg = !neg ? true : false; s = s.slice(1); }
    s = s.replace(/[₪\s,‎‏]/g, '');
    if (!/^\d*\.?\d+$/.test(s)) return null;
    const n = parseFloat(s);
    return neg ? -n : n;
  }

  /* תאריך: מספר סידורי של אקסל, Date, או טקסט d/m/y (פורמט ישראלי). מחזיר dayNum או null. */
  function parseDate(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date) return Calc.dayNum(v.getFullYear(), v.getMonth() + 1, v.getDate());
    if (typeof v === 'number') {
      if (v < 20000 || v > 80000) return null; // מחוץ לטווח תאריכים סביר (1954-2119)
      return Math.floor(v) - 25569;
    }
    const s = String(v).trim().replace(/[‎‏]/g, '');
    let m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
    if (m) {
      let d = +m[1], mo = +m[2], y = +m[3];
      if (y < 100) y += 2000;
      if (mo > 12 && d <= 12) { const t = d; d = mo; mo = t; }
      if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
      return Calc.dayNum(y, mo, d);
    }
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return Calc.dayNum(+m[1], +m[2], +m[3]);
    return null;
  }

  const HEADER_RULES = [
    ['date', /תאריך|date/i],
    ['desc', /תיאור|תאור|פרטים|הסבר|פירוט|description|details/i],
    ['ref', /אסמכתא|מס['׳]?\s*מסמך|מסמך|reference/i],
    ['debit', /חובה|debit/i],
    ['credit', /זכות|credit/i],
    ['balance', /יתרה|יתרת|balance/i],
    ['amount', /סכום|amount/i],
  ];

  /* זיהוי שורת כותרת ומיפוי עמודות. אם לא נמצאה: ברירת מחדל K,M,N,O לפי סקיל רם. */
  function detectLayout(grid) {
    let best = null;
    const limit = Math.min(grid.length, 40);
    for (let i = 0; i < limit; i++) {
      const row = grid[i] || [];
      const cols = {};
      let hits = 0;
      row.forEach((cell, idx) => {
        const t = cell == null ? '' : String(cell).trim();
        if (!t) return;
        for (const [key, re] of HEADER_RULES) {
          if (cols[key] == null && re.test(t)) {
            if (key === 'amount' && (cols.debit != null || cols.credit != null) && false) continue;
            cols[key] = idx;
            hits++;
            break;
          }
        }
      });
      if (cols.date != null && hits >= 3 && (!best || hits > best.hits)) best = { headerRow: i, cols, hits };
    }
    if (best) return { headerRow: best.headerRow, cols: best.cols, detected: true };
    return { headerRow: -1, cols: { date: 10, desc: 12, amount: 13, balance: 14 }, detected: false };
  }

  const OPENING_RE = /יתרת\s*פתיחה|יתרה\s*קודמת|יתרה\s*מועברת|יתרת\s*העברה|יתרה\s*מהשנה|יתרה\s*פותחת|opening/i;
  const TOTAL_RE = /סה["״'׳]?כ|סך\s*הכל|סיכום|total/i;
  const INTEREST_RE = /(ריבית|הצמדה)[^\n]{0,20}3\s*[\(\[]?\s*[טי]|ריבית\s+רעיונית|ריבית\s+3/i;

  function parseLedger(grid, mapping, opts) {
    opts = opts || {};
    const balNegIsDebit = opts.balNegIsDebit !== false;
    const amountPosIsDebit = opts.amountPosIsDebit !== false;
    const c = mapping.cols;
    const startRow = (mapping.headerRow != null ? mapping.headerRow : -1) + 1;
    const issues = [];
    const raw = [];
    for (let i = startRow; i < grid.length; i++) {
      const r = grid[i] || [];
      const get = (k) => (c[k] == null || c[k] < 0 ? null : r[c[k]]);
      const desc = get('desc') == null ? '' : String(get('desc')).trim();
      const date = parseDate(get('date'));
      const debit = parseNum(get('debit'));
      const credit = parseNum(get('credit'));
      const amount = parseNum(get('amount'));
      const balance = parseNum(get('balance'));
      const hasNum = debit != null || credit != null || amount != null;
      const isOpening = OPENING_RE.test(desc);
      if (date == null && !isOpening) {
        if (hasNum && desc && !TOTAL_RE.test(desc)) issues.push({ row: i + 1, msg: 'שורה עם סכום ללא תאריך תקין, דולגה: ' + desc });
        continue;
      }
      if (!hasNum && !(isOpening && balance != null)) continue;
      raw.push({ i, date, desc, ref: get('ref') == null ? '' : String(get('ref')).trim(), debit, credit, amount, balance, isOpening });
    }

    // קוטביות עמודת סכום יחיד ביחס ליתרה
    const useDC = c.debit != null || c.credit != null;
    let polarity = 1;
    if (!useDC && c.balance != null) {
      let votes = 0;
      for (let k = 1; k < raw.length; k++) {
        const a = raw[k].amount, b = raw[k].balance, pb = raw[k - 1].balance;
        if (a == null || b == null || pb == null || a === 0) continue;
        const delta = b - pb;
        if (Math.abs(Math.abs(a) - Math.abs(delta)) < 0.01 && delta !== 0) votes += Math.sign(a) * Math.sign(delta);
      }
      polarity = votes >= 0 ? 1 : -1;
    }

    const rows = [];
    let seq = 0;
    for (const x of raw) {
      let debit = 0, credit = 0;
      if (useDC) {
        debit = Math.abs(x.debit || 0);
        credit = Math.abs(x.credit || 0);
        if (x.isOpening && debit === 0 && credit === 0 && x.balance != null) {
          const net = balNegIsDebit ? -x.balance : x.balance;
          if (net >= 0) debit = net; else credit = -net;
        }
      } else if (x.isOpening && x.balance != null) {
        const net = balNegIsDebit ? -x.balance : x.balance;
        if (net >= 0) debit = net; else credit = -net;
      } else if (x.amount != null) {
        const net = c.balance != null
          ? (balNegIsDebit ? -1 : 1) * polarity * x.amount
          : (amountPosIsDebit ? 1 : -1) * x.amount;
        if (net >= 0) debit = net; else credit = -net;
      }
      const ext = x.balance == null ? null : (balNegIsDebit ? -x.balance : x.balance);
      const interestRow = !x.isOpening && INTEREST_RE.test(x.desc);
      rows.push({
        seq: seq++,
        srcRow: x.i + 1,
        date: x.date,
        desc: x.desc,
        ref: x.ref,
        debit: Calc.round2(debit),
        credit: Calc.round2(credit),
        extBalance: ext,
        kind: x.isOpening ? 'opening' : 'move',
        excluded: interestRow,
        autoExcluded: interestRow,
      });
    }
    return { rows, issues, polarity };
  }

  /* התאמת יתרת הכרטסת: בודק שהיתרה שבקובץ תואמת לצבירת התנועות (כולל שורות שהוחרגו מהחישוב). */
  function reconcile(rows) {
    const diffs = [];
    let prevExt = null;
    for (const r of rows) {
      const net = (r.debit || 0) - (r.credit || 0);
      if (r.extBalance != null) {
        if (prevExt != null && r.kind !== 'opening' && Math.abs(r.extBalance - (prevExt + net)) > 0.5) {
          diffs.push({ srcRow: r.srcRow, date: r.date, expected: Calc.round2(prevExt + net), actual: r.extBalance });
        }
        prevExt = r.extBalance;
      } else if (prevExt != null) prevExt += net;
    }
    return { checked: rows.filter((r) => r.extBalance != null).length, diffs };
  }

  return { parseNum, parseDate, detectLayout, parseLedger, reconcile, OPENING_RE, INTEREST_RE };
});
