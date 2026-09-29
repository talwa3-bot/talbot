/* חיבור בין הכרטסות, ההגדרות והחישוב: בונה את הקשר (ctx) לייצוא ולתצוגה. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./calc.js'), require('./parse.js'), require('./export-common.js'));
  else root.Pipeline = factory(root.Calc, root.Parse, root.ExportCommon);
})(typeof self !== 'undefined' ? self : this, function (Calc, Parse, X) {
  /* סוג הצד הקשור קובע רק ברירות מחדל וההערות. ההחלטה המקצועית נשארת אצל הסוקר. */
  const TYPES = {
    shareholder: { label: 'בעל מניות (מהותי)', debit: 's3t', credit: 's3y', note: '' },
    shareholderMinor: { label: 'בעל מניות (לא מהותי)', debit: 'none', credit: 's3y', note: 'בעל מניות שאינו מהותי: סעיף 3(ט) חל לגבי בעל מניות מהותי, יש לבחון החלה.' },
    related: { label: 'חברה קשורה', debit: 's3y', credit: 's3y', note: 'חברה קשורה: הלוואות בין צדדים קשורים נבחנות לפי 3(י). יש לבחון גם 3(ט1) ואת מבנה ההחזקות.' },
    relative: { label: 'קרוב משפחה', debit: 'none', credit: 's3y', note: 'קרוב: יש לבחון את הסעיף המתאים ואת הקשר.' },
    employee: { label: 'עובד', debit: 'none', credit: 's3y', note: 'הלוואת מעסיק לעובד: קיים פטור/שיעור מופחת עד תקרה (8,640 ש"ח לפי פרסומים לתקופה 2024-2027, לאמת).' },
    other: { label: 'אחר', debit: 'none', credit: 's3y', note: '' },
  };

  function ratesFor(state, year) {
    const def = Calc.DEFAULT_RATES[year] || {};
    const man = (state.rates && state.rates[year]) || {};
    const pick = (k) => (man[k] !== '' && man[k] != null && !isNaN(Number(man[k])) ? Number(man[k]) : def[k]);
    return { s3t: pick('s3t'), s3y: pick('s3y'), s3t1: pick('s3t1'), vat: pick('vat'), cpi: pick('cpi') };
  }

  /* מחזיר רשימת שדות שיעור חסרים לשנה, כדי לחסום חישוב עד להזנה ידנית. */
  function missingRates(state, year, sec) {
    const r = ratesFor(state, year);
    const miss = [];
    if (sec.debit === 's3t' && r.s3t == null) miss.push('s3t');
    if (sec.debit === 's3t1' && r.s3t1 == null) miss.push('s3t1');
    if (sec.credit === 's3y' && r.s3y == null) miss.push('s3y');
    if ((sec.debit === 's3t' || sec.debit === 's3t1') && sec.vatOnDebit && r.vat == null) miss.push('vat');
    return miss;
  }

  function groupLedgers(ledgers) {
    const map = new Map();
    for (const l of ledgers) {
      const key = (l.group || l.name || '').trim() || l.name;
      if (!map.has(key)) map.set(key, { name: key, ledgers: [], type: l.type });
      map.get(key).ledgers.push(l);
    }
    return Array.from(map.values());
  }

  function mergedRows(g) {
    const rows = [];
    g.ledgers.forEach((l, li) => {
      l.rows.forEach((r) => rows.push(Object.assign({}, r, { srcName: l.name + (l.sheetName ? ' / ' + l.sheetName : ''), _ord: li })));
    });
    rows.sort((a, b) => (a.date == null ? -1e9 : a.date) - (b.date == null ? -1e9 : b.date) || a._ord - b._ord || a.seq - b.seq);
    return rows;
  }

  function yearsInRows(rows) {
    const s = new Set();
    rows.forEach((r) => { if (r.date != null && r.kind !== 'opening') s.add(Calc.fromDayNum(r.date).y); });
    return Array.from(s).sort();
  }

  function buildContext(state) {
    const groups = [];
    const blocked = [];
    for (const g of groupLedgers(state.ledgers)) {
      const rows = mergedRows(g);
      const t = TYPES[g.type] || TYPES.other;
      const sec = Object.assign({}, state.settings);
      // סעיף לחיוב יתרת חובה: ברירת מחדל לפי סוג הצד, אלא אם המשתמש קבע ידנית לכרטסת
      const lg = g.ledgers[0];
      sec.debitSection = lg.debitSection || (t.debit === 's3y' ? 'none' : t.debit);
      sec.creditSection = lg.creditSection || t.credit;
      const years = [];
      for (const year of state.years) {
        const missing = missingRates(state, year, { debit: sec.debitSection, credit: sec.creditSection, vatOnDebit: sec.vatOnDebit });
        if (missing.length) { blocked.push({ group: g.name, year, missing }); continue; }
        const od = Calc.deriveOpening(rows, year);
        const ov = g.ledgers.map((l) => l.openingOverride && l.openingOverride[year]).find((v) => v != null && v !== '');
        const opening = ov != null ? Number(ov) : od.value;
        const rates = ratesFor(state, year);
        const opts = {
          year, opening, rates, debitSection: sec.debitSection, creditSection: sec.creditSection,
          vatOnDebit: sec.vatOnDebit && sec.debitSection !== 'none' && (sec.debitSection === 's3t' || state.vatOn3t1),
          grossIncludesVat: sec.grossIncludesVat, daysMethod: sec.daysMethod, extendToYearEnd: sec.extendToYearEnd,
        };
        const res = Calc.computeYear(rows, opts);
        const cmp = Calc.dailyBalanceInterest(rows, opts);
        const recon = { checked: 0, diffs: [] };
        g.ledgers.forEach((l) => { const rc = Parse.reconcile(l.rows); recon.checked += rc.checked; recon.diffs.push(...rc.diffs); });
        const ys = Calc.dayNum(year, 1, 1), ye = Calc.dayNum(year, 12, 31);
        const excludedRows = rows.filter((r) => r.excluded && r.date != null && r.date >= ys && r.date <= ye);
        const excludedNet = excludedRows.reduce((s, r) => s + (r.debit || 0) - (r.credit || 0), 0);
        let extClosing = null;
        if (g.ledgers.length === 1) {
          const inYear = g.ledgers[0].rows.filter((r) => r.date != null && r.date <= ye && r.extBalance != null);
          if (inYear.length) extClosing = Calc.round2(inYear[inYear.length - 1].extBalance);
        }
        years.push({
          year, opening, openingSource: ov != null ? 'הוזנה ידנית' : od.source, openingFound: od.found || ov != null,
          res, cmp, recon, settings: { daysMethod: sec.daysMethod, vatOnDebit: opts.vatOnDebit, grossIncludesVat: sec.grossIncludesVat, bookCreditInterest: !!state.bookCreditInterest },
          rates, excludedRows, excludedNet, extClosing,
        });
      }
      groups.push({
        name: g.name, type: g.type, typeLabel: t.label, typeNote: t.note, ledgers: g.ledgers.map((l) => l.name), rows,
        issues: g.ledgers.flatMap((l) => l.issues || []), years, debitSection: sec.debitSection, creditSection: sec.creditSection,
        review: lg.review || {},
      });
    }
    return {
      company: state.company, preparer: state.preparer, createdLabel: X.createdLabel(new Date()), accounts: state.accounts || {},
      groups, blocked, state,
    };
  }

  return { TYPES, ratesFor, missingRates, groupLedgers, mergedRows, yearsInRows, buildContext };
});
