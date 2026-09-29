/* מנוע חישוב ריבית רעיונית 3(ט) / 3(י) / 3(ט1), בשיטת רם ניהול פלוס.
 * מוסכמת סימנים פנימית: חובה מגדיל יתרת חובה (בעל המניות חייב לחברה).
 * יתרה חיובית = יתרת חובה (3ט). יתרה שלילית = יתרת זכות (3י). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Calc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const DAY = 86400000;

  const dayNum = (y, m, d) => Math.round(Date.UTC(y, m - 1, d) / DAY);
  const fromDayNum = (n) => {
    const d = new Date(n * DAY);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
  };
  const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const daysInYear = (y) => (isLeap(y) ? 366 : 365);
  const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  const pad = (n) => String(n).padStart(2, '0');
  const fmtDate = (n) => {
    if (n == null) return '';
    const { y, m, d } = fromDayNum(n);
    return pad(d) + '/' + pad(m) + '/' + y;
  };
  const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
  const round0 = (x) => Math.round(x);

  /* שיעורים מובנים (באחוזים). שנים אחרות: הזנה ידנית.
   * 2024/2025: לפי הסקיל. 2026: 6.53 / 4.9 (מקור: פרסומים ציבוריים, יש לאמת מול חוזר רשות המסים). */
  const DEFAULT_RATES = {
    2024: { s3t: 6.91, s3y: 5.18, vat: 17, source: 'סקיל רם ניהול' },
    2025: { s3t: 6.69, s3y: 5.02, vat: 18, source: 'סקיל רם ניהול' },
    2026: { s3t: 6.53, s3y: 4.9, vat: 18, source: 'פרסום ציבורי, לאמת מול חוזר רשות המסים' },
  };

  /* יתרת פתיחה לשנה: תנועות/שורות פתיחה לפני 1.1 של השנה. */
  function deriveOpening(rows, year) {
    const start = dayNum(year, 1, 1);
    let sum = 0;
    let count = 0;
    let openingRow = false;
    for (const r of rows) {
      if (r.excluded) continue;
      const net = (r.debit || 0) - (r.credit || 0);
      if (r.kind === 'opening') {
        if (r.date == null || r.date <= start) {
          sum += net;
          count++;
          openingRow = true;
        }
      } else if (r.date != null && r.date < start) {
        sum += net;
        count++;
      }
    }
    return {
      value: round2(sum),
      count,
      source: count === 0 ? 'לא נמצאה יתרת פתיחה, נדרשת הזנה ידנית' : openingRow ? 'שורת יתרת פתיחה / תנועות קודמות' : 'צבירת תנועות שלפני השנה',
      found: count > 0,
    };
  }

  /* חישוב שנה אחת.
   * opts: { year, opening, rates:{s3t,s3y,s3t1,vat,cpi}, debitSection:'s3t'|'s3t1'|'none',
   *         creditSection:'s3y'|'none', vatOnDebit, grossIncludesVat, daysMethod:'ram'|'calendar',
   *         extendToYearEnd } */
  function computeYear(rows, opts) {
    const y = opts.year;
    const rates = opts.rates || {};
    const start = dayNum(y, 1, 1);
    const end = dayNum(y, 12, 31);
    const DIY = daysInYear(y);
    const move = rows
      .filter((r) => !r.excluded && r.kind !== 'opening' && r.date != null && r.date >= start && r.date <= end)
      .sort((a, b) => a.date - b.date || (a.seq || 0) - (b.seq || 0));

    const months = [];
    for (let m = 1; m <= 12; m++) months.push({ m, debit: 0, credit: 0, last: null, count: 0 });
    for (const r of move) {
      const mo = months[fromDayNum(r.date).m - 1];
      mo.debit += r.debit || 0;
      mo.credit += r.credit || 0;
      mo.count++;
      if (mo.last == null || r.date > mo.last) mo.last = r.date;
    }

    const debitKey = opts.debitSection === 's3t1' ? 's3t1' : opts.debitSection === 'none' ? null : 's3t';
    const creditKey = opts.creditSection === 'none' ? null : 's3y';
    const rateD = debitKey ? Number(rates[debitKey]) || 0 : 0;
    const rateC = creditKey ? Number(rates[creditKey]) || 0 : 0;
    const cpi = Number(rates.cpi) || 0;

    let bal = opts.opening || 0;
    let prevEnd = dayNum(y - 1, 12, 31);
    const out = [];
    for (const mo of months) {
      const monthEnd = dayNum(y, mo.m, daysInMonth(y, mo.m));
      let effEnd = mo.last != null ? mo.last : monthEnd;
      if (mo.m === 12 && opts.extendToYearEnd !== false) effEnd = end;
      const days = opts.daysMethod === 'calendar' ? daysInMonth(y, mo.m) : Math.max(0, effEnd - prevEnd);
      const open = bal;
      const base = round0(open); // רם מחשב על יתרת פתיחה מעוגלת לשקל
      bal = open + mo.debit - mo.credit;
      const side = base > 0 ? 'D' : base < 0 ? 'C' : '';
      const rate = side === 'D' ? rateD : side === 'C' ? rateC : 0;
      const interestD = side === 'D' ? (base * rateD) / 100 / DIY * days : 0;
      const interestC = side === 'C' ? (-base * rateC) / 100 / DIY * days : 0;
      const linkage = side === 'C' ? (-base * cpi) / 100 / DIY * days : 0;
      out.push({
        month: mo.m,
        open: round2(open),
        base,
        debit: round2(mo.debit),
        credit: round2(mo.credit),
        close: round2(bal),
        days,
        side,
        rate,
        interestD,
        interestC,
        linkage,
        count: mo.count,
        periodStart: prevEnd,
        periodEnd: effEnd,
      });
      prevEnd = effEnd;
    }

    const sum = (k) => out.reduce((s, r) => s + r[k], 0);
    const grossD = sum('interestD');
    const vatRate = Number(rates.vat) || 0;
    const vatOn = opts.vatOnDebit !== false;
    let netD, vatD, totalD;
    if (!vatOn) {
      netD = round0(grossD);
      vatD = 0;
      totalD = netD;
    } else if (opts.grossIncludesVat !== false) {
      totalD = round0(grossD);
      netD = round0(grossD / (1 + vatRate / 100));
      vatD = totalD - netD;
    } else {
      netD = round0(grossD);
      vatD = round0((grossD * vatRate) / 100);
      totalD = netD + vatD;
    }
    const totals = {
      debit: round2(sum('debit')),
      credit: round2(sum('credit')),
      opening: round2(opts.opening || 0),
      closing: round2(bal),
      days: sum('days'),
      grossD: round2(grossD),
      netD,
      vatD,
      totalD,
      interestC: round0(sum('interestC')),
      interestCRaw: round2(sum('interestC')),
      linkage: round0(sum('linkage')),
      linkageRaw: round2(sum('linkage')),
      vatRate,
      diy: DIY,
      rateD,
      rateC,
      cpi,
      debitKey,
      creditKey,
    };
    return { year: y, months: out, totals, txCount: move.length };
  }

  /* השוואה: חישוב לפי יתרה יומית בפועל (לא שיטת רם), להצגה בבקרות בלבד. */
  function dailyBalanceInterest(rows, opts) {
    const y = opts.year;
    const start = dayNum(y, 1, 1);
    const end = dayNum(y, 12, 31);
    const DIY = daysInYear(y);
    const rates = opts.rates || {};
    const rateD = opts.debitSection === 's3t1' ? Number(rates.s3t1) || 0 : opts.debitSection === 'none' ? 0 : Number(rates.s3t) || 0;
    const rateC = opts.creditSection === 'none' ? 0 : Number(rates.s3y) || 0;
    const move = rows.filter((r) => !r.excluded && r.kind !== 'opening' && r.date != null && r.date >= start && r.date <= end);
    const byDay = new Map();
    for (const r of move) byDay.set(r.date, (byDay.get(r.date) || 0) + (r.debit || 0) - (r.credit || 0));
    let bal = opts.opening || 0;
    let d = 0;
    let c = 0;
    let avgAcc = 0;
    for (let n = start; n <= end; n++) {
      bal += byDay.get(n) || 0;
      avgAcc += bal;
      if (bal > 0) d += (bal * rateD) / 100 / DIY;
      else if (bal < 0) c += (-bal * rateC) / 100 / DIY;
    }
    return { interestD: round2(d), interestC: round2(c), avgBalance: round2(avgAcc / (end - start + 1)) };
  }

  return {
    DAY, dayNum, fromDayNum, isLeap, daysInYear, daysInMonth, fmtDate, round2, round0,
    DEFAULT_RATES, deriveOpening, computeYear, dailyBalanceInterest,
  };
});
