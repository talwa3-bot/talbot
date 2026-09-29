/* לשונית "בודק משיכות בעלים וניתוח כרטסת". נטענת לפני ui.js. */
(function () {
  'use strict';
  const { Calc, Classify: K, ExportAnalysis: EA, ExportInterest: EI } = window;
  const ExcelJS = window.ExcelJS;

  const QUESTIONS = [
    ['loanAgreement', 'קיים הסכם הלוואה כתוב?', [['unknown', 'לא ידוע'], ['yes', 'כן'], ['no', 'לא']]],
    ['interestPaid', 'שולמה ריבית על היתרה?', [['unknown', 'לא ידוע'], ['yes', 'כן'], ['no', 'לא']]],
    ['offsets', 'בוצעו קיזוזים, החזרים או חלוקות?', [['unknown', 'לא ידוע'], ['yes', 'כן'], ['no', 'לא']]],
    ['controlling', 'לבעל המניות יש שליטה בחברה?', [['unknown', 'לא ידוע'], ['yes', 'כן'], ['no', 'לא']]],
    ['dividendDecision', 'קיימת החלטה מתועדת על דיבידנד?', [['unknown', 'לא ידוע'], ['yes', 'כן'], ['no', 'לא'], ['na', 'לא רלוונטי']]],
  ];
  const SEV = { high: ['גבוהה', 'bad'], medium: ['בינונית', 'warn'], low: ['נמוכה', 'ok'] };

  function render(state, ctx, h) {
    const { esc, fmt, fmt0 } = h;
    const p = state.ui.analysisParams;
    if (!ctx || !ctx.groups.some((g) => g.years.length)) {
      state._analyses = [];
      return `<section class="step"><h2><span class="num">1</span> בודק משיכות בעלים</h2><p class="hint">העלה כרטסת בלשונית "ריבית רעיונית", בחר שנת מס ושיעורים, ואז חזור לכאן. הבודק משתמש באותה כרטסת ובאותן הגדרות.</p></section>`;
    }
    const analyses = K.analyzeAll(ctx, p);
    state._analyses = analyses;
    const params = `<section class="step"><h2><span class="num">1</span> בודק משיכות בעלים וניתוח כרטסת</h2>
      <p class="hint">הבודק מסווג כל תנועה (שכר, דיבידנד, הלוואה, משיכה פרטית), מסמן תנועות חריגות ומעריך חשיפות. הסיווג האוטומטי מבוסס על מילות מפתח, ותמיד אפשר לתקן אותו ידנית בטבלת התנועות.</p>
      <div class="grid">
        <label class="f">משיכה גדולה מ- (ש"ח)<input type="number" data-fid="ap-big" data-ap="bigAmount" value="${p.bigAmount}"></label>
        <label class="f">שיעור מס דיבידנד %<input type="number" step="0.5" data-fid="ap-div" data-ap="divRate" value="${p.divRate}"><small>25% רגיל, 30% בעל מניות מהותי. לא כולל מס יסף</small></label>
        <label class="f">מס שולי על שכר %<input type="number" step="0.5" data-fid="ap-sal" data-ap="salaryRate" value="${p.salaryRate}"></label>
        <label class="f">עלות מעסיק וביטוח לאומי נוספת %<input type="number" step="0.5" data-fid="ap-emp" data-ap="employerRate" value="${p.employerRate}"></label>
      </div></section>`;
    const blocks = analyses.map((it, idx) => block(it, idx, state, h)).join('');
    return params + blocks + `<section class="step"><h2><span class="num">3</span> הורדה</h2>
      <p class="hint">"ניתוח כרטסת בעל מניות" הוא נייר העבודה השני. "הכול בקובץ אחד" כולל גם את נייר עבודה הריבית הרעיונית, פקודות היומן והבקרות.</p>
      <div class="actions">
        <button class="primary big" id="dl-analysis">הורד: ניתוח כרטסת בעל מניות (אקסל)</button>
        <button class="big" id="dl-all">הורד הכול בקובץ אחד (ריבית + ניתוח)</button>
      </div></section>`;
  }

  function block(it, idx, state, h) {
    const { esc, fmt, fmt0 } = h;
    const { group, yb, a } = it;
    const lid = state.ledgers.find((l) => (l.group || l.name) === group.name || l.name === group.name);
    const lidId = lid ? lid.id : '';
    const qs = QUESTIONS.map(([k, label, opts]) => `<label class="f">${label}<select data-rv="${lidId}:${k}">${opts.map(([v, t]) => `<option value="${v}" ${(group.review[k] || 'unknown') === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>`).join('');
    const e = a.exposure;
    const ind = a.indicators.length ? a.indicators.map((i) => `<div class="alert ${SEV[i.sev][1]}"><b>רמה ${SEV[i.sev][0]}:</b> ${esc(i.text)}</div>`).join('') : '<div class="alert ok">לא זוהו אינדיקטורים חריגים לפי הנתונים שהוזנו.</div>';
    const cats = Object.keys(K.CATS).filter((k) => k !== 'opening' && a.byCat[k].count).map((k) => `<tr><td class="l">${K.CATS[k]}</td><td>${a.byCat[k].count}</td><td>${fmt(a.byCat[k].debit)}</td><td>${fmt(a.byCat[k].credit)}</td><td>${fmt(a.byCat[k].debit - a.byCat[k].credit)}</td></tr>`).join('');
    const catOpts = (cur) => Object.entries(K.CATS).filter(([k]) => k !== 'opening').map(([k, v]) => `<option value="${k}" ${cur === k ? 'selected' : ''}>${v}</option>`).join('');
    const rowsHtml = a.rows.slice(0, 400).map((r) => `<tr><td>${Calc.fmtDate(r.date)}</td><td class="l">${esc(r.desc)}</td><td>${fmt(r.debit)}</td><td>${fmt(r.credit)}</td><td>${fmt(r.runBal)}</td><td class="l"><select data-cat="${r._lid}:${r.seq}" title="${esc(r.catReason)}">${catOpts(r.cat)}</select>${r.catConf === 'low' || r.catConf === 'none' ? ' <span class="pill warn">לבדוק</span>' : ''}</td><td class="l small">${esc(r.flags.map((f) => f.text).join('; '))}</td></tr>`).join('');
    const alts = K.alternatives(a).map((x) => `<tr><td class="l"><b>${esc(x.name)}</b></td><td class="l">${esc(x.pros)}</td><td class="l">${esc(x.cons)}</td><td class="l">${esc(x.risk)}<div class="small">${esc(x.evidence)}</div></td></tr>`).join('');
    return `<section class="step">
      <h2><span class="num">${2}</span> ${esc(group.name)}, שנת ${yb.year} <span class="pill ok">${esc(group.typeLabel)}</span></h2>
      <div class="card"><h3>שאלות סקירה</h3><div class="grid">${qs}</div><div class="small">התשובות משפיעות על האינדיקטורים והחשיפות, ונכללות בנייר העבודה.</div></div>
      <div class="kpis">
        <div class="kpi"><div class="k">יתרת פתיחה</div><div class="v">${fmt(a.opening)}</div></div>
        <div class="kpi"><div class="k">יתרת סגירה</div><div class="v">${fmt(a.closing)}</div></div>
        <div class="kpi"><div class="k">שיא יתרת חובה</div><div class="v">${fmt(a.peakD.value)}</div></div>
        <div class="kpi"><div class="k">חודשים ביתרת חובה (מתוך 12)</div><div class="v">${a.monthsDebit}</div></div>
        <div class="kpi"><div class="k">בסיס לא מתועד (נטו)</div><div class="v">${fmt0(e.undocNet)}</div></div>
        <div class="kpi"><div class="k">תנועות עם דגל</div><div class="v">${a.flagged.length}</div></div>
      </div>
      <h3>ממצאים ואינדיקטורים</h3>${ind}
      <h3>חשיפות מס פוטנציאליות (אומדן להמחשה)</h3>
      <div class="scroll"><table class="t"><tr><th>תרחיש</th><th>בסיס</th><th>חשיפה</th></tr>
        <tr><td class="l">הלוואה: ריבית רעיונית ומע"מ (על כל היתרה, בסיס: יתרה יומית ממוצעת)</td><td>${fmt0(a.avgBalance)}</td><td>${fmt0(e.loan.total)}</td></tr>
        <tr><td class="l">דיבידנד מוסווה (${e.dividend.rate}%)</td><td>${fmt0(e.undocNet)}</td><td>${fmt0(e.dividend.tax)}</td></tr>
        <tr><td class="l">שכר (${e.salary.rate}% + ${e.salary.employer}% עלות מעסיק)</td><td>${fmt0(e.undocNet)}</td><td>${fmt0(e.salary.tax)}</td></tr></table></div>
      <details><summary>חלופות סיווג: יתרונות, חסרונות וסיכונים</summary><div class="scroll"><table class="t"><tr><th>חלופה</th><th>יתרונות</th><th>חסרונות</th><th>חשיפה והוכחות</th></tr>${alts}</table></div></details>
      <details><summary>פילוח לפי סיווג</summary><div class="scroll"><table class="t"><tr><th>סיווג</th><th>תנועות</th><th>חובה</th><th>זכות</th><th>נטו</th></tr>${cats}</table></div></details>
      <details open><summary>כל התנועות בשנה עם סיווג (אפשר לשנות סיווג ידנית)</summary><div class="scroll" style="max-height:420px;overflow:auto"><table class="t"><tr><th>תאריך</th><th>תיאור</th><th>חובה</th><th>זכות</th><th>יתרה רצה</th><th>סיווג</th><th>דגלים</th></tr>${rowsHtml}</table></div>${a.rows.length > 400 ? '<div class="small">מוצגות 400 תנועות ראשונות, בקובץ האקסל כולן.</div>' : ''}</details>
      <details><summary>מסמכים מומלצים ופעולות תיקון</summary><b>מסמכים</b><ul>${K.documents(a).map((d) => `<li>${esc(d)}</li>`).join('')}</ul><b>פעולות</b><ul>${K.actions(a).map((d) => `<li>${esc(d)}</li>`).join('')}</ul></details>
    </section>`;
  }

  function bind(state, ctx, h) {
    const $$ = (s) => Array.from(document.querySelectorAll(s));
    $$('[data-ap]').forEach((el) => el.addEventListener('change', () => { state.ui.analysisParams[el.dataset.ap] = Number(el.value); h.render(); }));
    $$('[data-rv]').forEach((el) => el.addEventListener('change', () => {
      const [id, key] = el.dataset.rv.split(':');
      const l = h.find(id);
      // הסקירה נשמרת על הכרטסת הראשונה בקבוצה
      const grp = state.ledgers.filter((x) => (x.group || x.name) === (l.group || l.name));
      (grp[0] || l).review = Object.assign({}, (grp[0] || l).review, { [key]: el.value });
      h.render();
    }));
    $$('[data-cat]').forEach((el) => el.addEventListener('change', () => {
      const [id, seq] = el.dataset.cat.split(':');
      const l = h.find(id);
      const r = l.rows.find((x) => x.seq === Number(seq));
      r.catOverride = el.value;
      h.render();
    }));
    const a1 = document.getElementById('dl-analysis');
    if (a1) a1.addEventListener('click', async () => {
      try {
        const { wb } = EA.buildAnalysisWorkbook(ExcelJS, ctx, state._analyses);
        h.download(await wb.xlsx.writeBuffer(), 'shareholder-ledger-analysis_' + state.years.join('-') + '.xlsx');
        h.toast('הקובץ ירד');
      } catch (e) { console.error(e); h.toast('שגיאה ביצירת הקובץ: ' + e.message); }
    });
    const a2 = document.getElementById('dl-all');
    if (a2) a2.addEventListener('click', async () => {
      try {
        const { wb, used } = EI.buildInterestWorkbook(ExcelJS, ctx, { skipTransactions: true });
        EA.addAnalysisSheets(wb, used, ctx, state._analyses);
        h.download(await wb.xlsx.writeBuffer(), 'audit-workpapers_' + state.years.join('-') + '.xlsx');
        h.toast('הקובץ ירד');
      } catch (e) { console.error(e); h.toast('שגיאה ביצירת הקובץ: ' + e.message); }
    });
  }

  window.AnalysisUI = { render, bind };
})();
