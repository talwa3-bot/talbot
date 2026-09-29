/* בודק משיכות בעלים: סיווג תנועות, דגלי סיכון, חשיפות וחלופות סיווג.
 * כל התוצאות הן כלי עזר לסוקר ולא קביעה משפטית. הסיווג האוטומטי לפי מילות מפתח ניתן לעריכה ידנית. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./calc.js'));
  else root.Classify = factory(root.Calc);
})(typeof self !== 'undefined' ? self : this, function (Calc) {
  const CATS = {
    opening: 'יתרת פתיחה',
    salary: 'שכר / משכורת',
    dividend: 'דיבידנד',
    loan_out: 'הלוואה לבעל המניות',
    loan_in: 'הלוואה מבעל המניות לחברה',
    repay: 'החזר / פירעון',
    withdrawal: 'משיכה פרטית',
    expense: 'החזר הוצאות',
    interest: 'ריבית / הצמדה',
    vat: 'מע"מ',
    capital: 'הפקדה / הזרמת הון',
    unclassified: 'לא מסווג',
  };

  const R = {
    interest: /ריבית|הצמדה/,
    vat: /מע["״'׳]?מ|מעמ/,
    dividend: /דיבידנד|דיב['׳]|חלוקת\s*(רווחים|דיבידנד)/,
    salary: /משכורת|שכר|תלוש|שכ["״'׳]ע|בונוס|משכר/,
    loan: /הלוואה|הלוואת|הלואה/,
    repay: /החזר|פירעון|השבה|קיזוז|זיכוי/,
    expense: /החזר\s*הוצאות|הוצאות|נסיעות|דלק|ארוחות|אש["״'׳]ל|חשבונית|קבלה/,
    capital: /הפקדה|הפקדת|הזרמה|הזרמת|הון|השקעה/,
    withdrawalStrong: /משיכה|משיכת|משיכות/,
    withdrawalWeak: /העברה|העברת|צ['׳]ק|שיק|מזומן|כספומט|אשראי|פרטי|הוראת\s*קבע|בנק/,
  };

  function classifyRow(r) {
    if (r.kind === 'opening') return { cat: 'opening', reason: 'שורת יתרת פתיחה', confidence: 'high' };
    const d = r.desc || '';
    const debit = (r.debit || 0) > 0;
    const credit = (r.credit || 0) > 0;
    if (R.interest.test(d)) return { cat: 'interest', reason: 'מילת מפתח: ריבית/הצמדה', confidence: 'high' };
    if (R.vat.test(d)) return { cat: 'vat', reason: 'מילת מפתח: מע"מ', confidence: 'high' };
    if (R.dividend.test(d)) return { cat: 'dividend', reason: 'מילת מפתח: דיבידנד', confidence: 'high' };
    if (R.salary.test(d)) return { cat: 'salary', reason: 'מילת מפתח: שכר', confidence: 'high' };
    if (R.loan.test(d)) {
      if (credit && R.repay.test(d)) return { cat: 'repay', reason: 'החזר הלוואה', confidence: 'high' };
      return debit ? { cat: 'loan_out', reason: 'מילת מפתח: הלוואה (חובה)', confidence: 'medium' } : { cat: 'loan_in', reason: 'מילת מפתח: הלוואה (זכות)', confidence: 'medium' };
    }
    if (credit && R.repay.test(d)) return { cat: 'repay', reason: 'מילת מפתח: החזר', confidence: 'medium' };
    if (R.expense.test(d)) return { cat: 'expense', reason: 'מילת מפתח: הוצאות', confidence: 'low' };
    if (credit && R.capital.test(d)) return { cat: 'capital', reason: 'מילת מפתח: הפקדה/הון', confidence: 'medium' };
    if (debit && R.withdrawalStrong.test(d)) return { cat: 'withdrawal', reason: 'מילת מפתח: משיכה', confidence: 'high' };
    if (debit && R.withdrawalWeak.test(d)) return { cat: 'withdrawal', reason: 'תיאור תנועת כסף כללי', confidence: 'low' };
    return { cat: 'unclassified', reason: 'לא זוהתה מילת מפתח', confidence: 'none' };
  }

  const UNDOC_DEBIT = new Set(['withdrawal', 'unclassified', 'loan_out']);
  const UNDOC_CREDIT = new Set(['repay', 'capital']);

  const DEFAULT_PARAMS = { divRate: 30, salaryRate: 47, employerRate: 7.5, bigAmount: 10000 };

  function analyze(group, yb, paramsIn) {
    const params = Object.assign({}, DEFAULT_PARAMS, paramsIn || {});
    const y = yb.year;
    const start = Calc.dayNum(y, 1, 1);
    const end = Calc.dayNum(y, 12, 31);
    const review = group.review || {};
    const all = group.rows
      .filter((r) => r.kind !== 'opening' && r.date != null)
      .slice()
      .sort((a, b) => a.date - b.date || a.seq - b.seq);
    const rows = all.filter((r) => r.date >= start && r.date <= end);
    const nextJan = all.filter((r) => r.date > end && r.date <= end + 31);

    rows.forEach((r) => {
      const auto = classifyRow(r);
      r.cat = r.catOverride || auto.cat;
      r.catReason = r.catOverride ? 'שונה ידנית' : auto.reason;
      r.catConf = r.catOverride ? 'manual' : auto.confidence;
      r.catLabel = CATS[r.cat];
      r.flags = [];
    });

    // מסלול יתרה (כולל שורות הריבית שבכרטסת)
    let bal = yb.opening;
    let peakD = { value: bal > 0 ? bal : 0, date: null };
    let peakC = { value: bal < 0 ? -bal : 0, date: null };
    const monthEnd = new Array(13).fill(null);
    monthEnd[0] = bal;
    rows.forEach((r) => {
      bal += (r.debit || 0) - (r.credit || 0);
      r.runBal = Calc.round2(bal);
      if (bal > peakD.value) peakD = { value: bal, date: r.date };
      if (-bal > peakC.value) peakC = { value: -bal, date: r.date };
      monthEnd[Calc.fromDayNum(r.date).m] = bal;
    });
    let carry = yb.opening;
    let monthsDebit = 0;
    let monthsCredit = 0;
    for (let m = 1; m <= 12; m++) {
      if (monthEnd[m] == null) monthEnd[m] = carry;
      carry = monthEnd[m];
      if (carry > 0.5) monthsDebit++;
      else if (carry < -0.5) monthsCredit++;
    }

    // דגלים
    const seen = new Map();
    rows.forEach((r, i) => {
      const amt = (r.debit || 0) + (r.credit || 0);
      const key = [r.date, r.debit, r.credit, r.desc].join('|');
      if (seen.has(key)) { r.flags.push({ code: 'dup', text: 'תנועה כפולה אפשרית' }); seen.get(key).flags.push({ code: 'dup', text: 'תנועה כפולה אפשרית' }); }
      else seen.set(key, r);
      if (r.debit >= params.bigAmount && UNDOC_DEBIT.has(r.cat)) r.flags.push({ code: 'big', text: 'משיכה גדולה' });
      if (r.debit >= 5000 && r.debit % 1000 === 0 && UNDOC_DEBIT.has(r.cat)) r.flags.push({ code: 'round', text: 'סכום עגול' });
      if ((r.desc || '').trim().length < 3 && amt >= 1000) r.flags.push({ code: 'nodesc', text: 'ללא תיאור מספק' });
      if (r.cat === 'unclassified' && r.debit > 0) r.flags.push({ code: 'unclassified', text: 'משיכה ללא סיווג' });
      if (r.credit > 0 && (UNDOC_CREDIT.has(r.cat) || r.cat === 'unclassified')) {
        const hit = rows.slice(i + 1).find((x) => x.date <= r.date + 14 && x.debit > 0 && x.debit >= r.credit * 0.9 && x.debit <= r.credit * 1.1 && r.credit >= 5000);
        if (hit) { r.flags.push({ code: 'circular', text: 'החזר ואחריו משיכה דומה תוך 14 יום' }); }
      }
      if (r.credit >= 5000 && r.date >= Calc.dayNum(y, 12, 15) && r.cat !== 'interest') {
        const hit = nextJan.find((x) => x.debit > 0 && x.debit >= r.credit * 0.9 && x.debit <= r.credit * 1.1);
        if (hit) r.flags.push({ code: 'yearend', text: 'החזר לפני סוף השנה ומשיכה דומה בינואר (עיטור חלונות אפשרי)' });
      }
    });

    // סיכומים לפי סיווג
    const byCat = {};
    Object.keys(CATS).forEach((k) => { byCat[k] = { debit: 0, credit: 0, count: 0 }; });
    rows.forEach((r) => { const c = byCat[r.cat]; c.debit += r.debit || 0; c.credit += r.credit || 0; c.count++; });
    Object.values(byCat).forEach((c) => { c.debit = Calc.round2(c.debit); c.credit = Calc.round2(c.credit); });

    const loanAgree = review.loanAgreement === 'yes';
    const debitBase = rows.filter((r) => UNDOC_DEBIT.has(r.cat) && !(loanAgree && r.cat === 'loan_out')).reduce((s, r) => s + (r.debit || 0), 0);
    const creditBase = rows.filter((r) => UNDOC_CREDIT.has(r.cat)).reduce((s, r) => s + (r.credit || 0), 0);
    const undocNet = Math.max(0, Calc.round2(debitBase - creditBase));
    const t = yb.res.totals;
    const totalDebits = rows.reduce((s, r) => s + (r.debit || 0), 0);
    const unclassifiedDebit = rows.filter((r) => r.cat === 'unclassified').reduce((s, r) => s + (r.debit || 0), 0);

    const exposure = {
      undocNet,
      loan: { net: t.netD, vat: t.vatD, total: t.totalD },
      dividend: { base: undocNet, rate: params.divRate, tax: Calc.round0((undocNet * params.divRate) / 100) },
      salary: { base: undocNet, rate: params.salaryRate, employer: params.employerRate, tax: Calc.round0((undocNet * (params.salaryRate + params.employerRate)) / 100) },
    };

    // אינדיקטורים
    const ind = [];
    const closingDebit = t.closing > 0.5;
    const openingDebit = yb.opening > 0.5;
    if (openingDebit && closingDebit && monthsDebit === 12) ind.push({ sev: 'high', text: 'יתרת חובה לאורך כל השנה, כולל פתיחה וסגירה. לא נראה פירעון בפועל. יש לבחון אם מדובר בהלוואה אמיתית או במשיכה שיש לסווג מחדש.' });
    else if (closingDebit) ind.push({ sev: 'medium', text: 'יתרת סגירה בחובה של ' + Calc.round2(t.closing).toLocaleString('he-IL') + '. בעל המניות חייב לחברה בסוף השנה.' });
    if (closingDebit && review.loanAgreement !== 'yes') ind.push({ sev: 'high', text: review.loanAgreement === 'no' ? 'אין הסכם הלוואה כתוב ובכרטסת יתרת חובה: סיכון מיידי לסיווג מחדש.' : 'לא אושר קיומו של הסכם הלוואה כתוב. אם אין הסכם, קיים סיכון מיידי לסיווג מחדש. יש לברר.' });
    if (closingDebit && review.interestPaid === 'no') ind.push({ sev: 'high', text: 'לא שולמה ריבית על יתרת החובה. יש חשיפה לריבית רעיונית ' + (t.debitKey === 's3t1' ? '3(ט1)' : '3(ט)') + ' ולמע"מ עליה.' });
    if (closingDebit && review.controlling === 'yes') ind.push({ sev: 'medium', text: 'בעל שליטה עם יתרת חובה: יש לבחון גם את ההוראות לגבי בעל מניות מהותי.' });
    const hasInterestRows = rows.some((r) => r.cat === 'interest');
    if ((openingDebit || closingDebit) && !hasInterestRows) ind.push({ sev: 'medium', text: 'לא נרשמה בכרטסת ריבית רעיונית במהלך השנה.' });
    if (totalDebits > 0 && unclassifiedDebit / totalDebits > 0.3) ind.push({ sev: 'medium', text: 'מעל 30% מסך החובות אינם מסווגים (' + Math.round((unclassifiedDebit / totalDebits) * 100) + '%). מומלץ להשלים סיווג לפני מסקנה.' });
    if (byCat.dividend.count && review.dividendDecision === 'no') ind.push({ sev: 'high', text: 'נרשמו תנועות דיבידנד ללא החלטה מתועדת של החברה. יש לברר את המסמכים.' });
    if (review.offsets === 'yes') ind.push({ sev: 'low', text: 'דווח על קיזוזים / החזרים / חלוקות. יש לצרף אסמכתאות לכל אחד.' });
    if (rows.some((r) => r.flags.some((f) => f.code === 'yearend'))) ind.push({ sev: 'high', text: 'זוהה החזר סמוך לסוף השנה שאחריו משיכה דומה בינואר. ייתכן שהוא נועד להקטין את יתרת החובה בדוחות (עיטור חלונות אפשרי).' });
    if (rows.some((r) => r.flags.some((f) => f.code === 'circular'))) ind.push({ sev: 'medium', text: 'זוהו החזרים שאחריהם משיכה דומה תוך שבועיים.' });
    if (monthsCredit > 0 && t.linkageRaw === 0 && !t.cpi) ind.push({ sev: 'low', text: 'קיימת יתרת זכות (החברה חייבת לבעל המניות). יש לבחון ריבית מינימלית 3(י) והצמדה.' });
    if (t.days !== t.diy) ind.push({ sev: 'low', text: 'סך הימים בחישוב הריבית (' + t.days + ') שונה מימי השנה (' + t.diy + ').' });

    return {
      year: y, opening: yb.opening, closing: t.closing, peakD, peakC, monthsDebit, monthsCredit, avgBalance: yb.cmp.avgBalance,
      byCat, rows, exposure, indicators: ind, params, review, totalDebits: Calc.round2(totalDebits),
      totalCredits: Calc.round2(rows.reduce((s, r) => s + (r.credit || 0), 0)),
      flagged: rows.filter((r) => r.flags.length),
    };
  }

  function alternatives(a) {
    const e = a.exposure;
    const n = (x) => Number(x).toLocaleString('he-IL');
    return [
      { name: 'הלוואה אמיתית', pros: 'אם קיים הסכם, ריבית ופירעון צפוי, אין מס על המשיכה עצמה.', cons: 'נדרשת ריבית לפי 3(ט)/3(י) ומע"מ על הריבית. בלי הסכם וביצוע בפועל הטיעון חלש.', risk: 'ריבית רעיונית ' + n(e.loan.net) + ' + מע"מ ' + n(e.loan.vat), evidence: 'הסכם הלוואה חתום, לוח סילוקין, החלטת החברה, תשלומי ריבית והחזרים בפועל.' },
      { name: 'דיבידנד (חלוקה)', pros: 'פתרון סופי ליתרה. מקובל כשיש רווחים ראויים לחלוקה.', cons: 'מס בידי בעל המניות, נדרשות החלטה ומבחן יכולת פירעון, ודיווח במועד.', risk: 'מס דיבידנד משוער ' + n(e.dividend.tax) + ' (' + e.dividend.rate + '%, לא כולל מס יסף)', evidence: 'החלטת דירקטוריון/אסיפה, בחינת רווחים ראויים לחלוקה, ניכוי מס במקור.' },
      { name: 'שכר', pros: 'אם המשיכה בגין עבודה בפועל, ההוצאה מוכרת לחברה.', cons: 'מס שולי גבוה, ביטוח לאומי ועלות מעסיק, ודורש הצדקה לשיעור השכר.', risk: 'עלות משוערת ' + n(e.salary.tax) + ' (' + e.salary.rate + '% + ' + e.salary.employer + '%)', evidence: 'הסכם העסקה, תלושי שכר, דיווחים לרשויות, סבירות השכר.' },
      { name: 'משיכה פרטית ללא סיווג (מצב קיים)', pros: 'אין פעולה מיידית.', cons: 'סיכון לסיווג בידי פקיד השומה כדיבידנד מוסווה או הכנסה אחרת, בתוספת ריבית והצמדה.', risk: 'תלוי בסיווג שייקבע', evidence: '-' },
    ];
  }

  function documents(a) {
    const d = ['הסכם הלוואה כתוב וחתום (סכום, ריבית, מועדי פירעון)', 'החלטת החברה (דירקטוריון / אסיפה) על מתן ההלוואה או על חלוקה', 'אסמכתאות בנקאיות לכל משיכה מהותית', 'לוח סילוקין ואסמכתאות לתשלומי ריבית והחזרים', 'אישור על שיעור החזקה ומעמד בעל המניות בחברה', 'חישוב ריבית רעיונית לשנה (נייר העבודה הראשון)'];
    if (a.byCat.salary.count) d.push('תלושי שכר והסכם העסקה לגבי תנועות סווגו כשכר');
    if (a.byCat.dividend.count) d.push('פרוטוקול החלטה על דיבידנד, ניכוי מס במקור, דיווח לרשות המסים');
    if (a.byCat.expense.count) d.push('חשבוניות וקבלות להחזרי הוצאות');
    return d;
  }

  function actions(a) {
    const e = a.exposure;
    const act = [];
    if (a.closing > 0.5) act.push('לרשום ריבית רעיונית ומע"מ לפי נייר העבודה הראשון (פקודת היומן שם).');
    if (a.review.loanAgreement !== 'yes' && a.closing > 0.5) act.push('לגבש הסכם הלוואה, ולבחון עם היועץ אם ניתן לתעד אותו בדיעבד ואילו השלכות יש לכך.');
    if (e.undocNet > 0) act.push('לסווג את המשיכות שלא סווגו (סה"כ נטו ' + Number(e.undocNet).toLocaleString('he-IL') + ') להלוואה, דיבידנד או שכר, ולתעד החלטה.');
    if (a.indicators.some((i) => i.text.indexOf('עיטור') >= 0)) act.push('לבדוק את ההחזר בסוף השנה ואת המשיכה בינואר, ולהחליט על גילוי או תיקון.');
    act.push('להשלים את הסיווג הידני בטבלת התנועות ולהריץ מחדש את הניתוח.');
    act.push('לתאם את הסיווג הסופי והחשיפה עם רו"ח / יועץ מס לפני הגשת הדוח.');
    return act;
  }

  function analyzeAll(ctx, params) {
    const out = [];
    ctx.groups.forEach((g) => g.years.forEach((yb) => out.push({ group: g, yb, a: analyze(g, yb, params) })));
    return out;
  }

  return { CATS, classifyRow, analyze, alternatives, documents, actions, analyzeAll, DEFAULT_PARAMS };
});
