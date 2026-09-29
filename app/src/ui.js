/* ממשק המשתמש: הכול רץ בדפדפן, ללא שליחת נתונים לרשת. */
(function () {
  'use strict';
  const { Calc, Parse, Pipeline: PL, ExportInterest: EI } = window;
  const XLSXlib = window.XLSX;
  const ExcelJS = window.ExcelJS;
  const Classify = window.Classify || null;
  const ExportAnalysis = window.ExportAnalysis || null;

  const KNOWN_YEARS = [2024, 2025, 2026];
  const LS_KEY = 'shareholder-interest-tool:v1';

  const state = {
    tab: 'interest',
    company: '',
    preparer: '',
    years: [],
    customYears: [],
    rates: {},
    settings: { vatOnDebit: true, grossIncludesVat: true, daysMethod: 'ram', extendToYearEnd: true },
    vatOn3t1: false,
    bookCreditInterest: false,
    accounts: {
      shareholder: 'בעלי מניות',
      incomeD: 'הכנסות מימון - ריבית ',
      vat: 'מע"מ עסקאות',
      expenseC: 'הוצאות מימון - ריבית 3(י)',
      linkage: 'הוצאות מימון - הפרשי הצמדה',
    },
    ledgers: [],
    ui: { openResults: {}, analysisParams: { divRate: 30, salaryRate: 47, employerRate: 7.5, bigAmount: 10000 } },
  };
  window.__state = state;
  let nextId = 1;

  /* ---------- כלי עזר ---------- */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n, d) => {
    if (n == null || isNaN(n)) return '';
    return Number(n).toLocaleString('he-IL', { minimumFractionDigits: d == null ? 2 : d, maximumFractionDigits: d == null ? 2 : d });
  };
  const fmt0 = (n) => fmt(n, 0);
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 3500);
  }
  function save() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ company: state.company, preparer: state.preparer, rates: state.rates, customYears: state.customYears, settings: state.settings, vatOn3t1: state.vatOn3t1, accounts: state.accounts }));
    } catch (e) { /* אחסון מקומי לא זמין, אין בעיה */ }
  }
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
      if (s) Object.assign(state, { company: s.company || '', preparer: s.preparer || '', rates: s.rates || {}, customYears: s.customYears || [], vatOn3t1: !!s.vatOn3t1 }, {});
      if (s && s.settings) Object.assign(state.settings, s.settings);
      if (s && s.accounts) Object.assign(state.accounts, s.accounts);
    } catch (e) { /* התעלמות */ }
  }

  /* ---------- קריאת קבצים ---------- */
  function sheetToGrid(ws) {
    return XLSXlib.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', blankrows: true });
  }
  function pickSheet(wb) {
    let best = wb.SheetNames[0];
    let bestN = -1;
    for (const n of wb.SheetNames) {
      const g = sheetToGrid(wb.Sheets[n]);
      if (g.length > bestN) { bestN = g.length; best = n; }
    }
    return best;
  }
  function colLabel(i) {
    let s = '';
    i++;
    while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
    return s;
  }
  function reparse(l) {
    l.grid = sheetToGrid(l.wb.Sheets[l.sheetName]);
    if (!l.mapping) l.mapping = Parse.detectLayout(l.grid);
    const keep = l.rows ? new Map(l.rows.map((r) => [r.srcRow + ':' + r.seq, r.excluded])) : null;
    const res = Parse.parseLedger(l.grid, l.mapping, { balNegIsDebit: l.balNegIsDebit, amountPosIsDebit: l.amountPosIsDebit });
    if (keep && l._manualExcl) res.rows.forEach((r) => { const k = r.srcRow + ':' + r.seq; if (l._manualExcl.has(k)) r.excluded = l._manualExcl.get(k); });
    l.rows = res.rows;
    l.issues = res.issues;
    l.polarity = res.polarity;
  }
  async function addFiles(files) {
    for (const f of files) {
      if (/\.(xls|xlsx|xlsm|csv)$/i.test(f.name) === false) { toast('קובץ לא נתמך: ' + f.name); continue; }
      try {
        const buf = await f.arrayBuffer();
        const wb = XLSXlib.read(buf, { type: 'array', cellDates: false });
        const sheetName = pickSheet(wb);
        const l = {
          id: nextId++, fileName: f.name, name: f.name.replace(/\.[^.]+$/, ''), wb, sheetNames: wb.SheetNames, sheetName,
          type: 'shareholder', group: f.name.replace(/\.[^.]+$/, ''), balNegIsDebit: true, amountPosIsDebit: true,
          openingOverride: {}, review: {}, _manualExcl: new Map(),
        };
        reparse(l);
        state.ledgers.push(l);
        if (!l.rows.length) toast('לא זוהו תנועות ב: ' + f.name + '. בדוק את מיפוי העמודות.');
      } catch (e) {
        console.error(e);
        toast('שגיאה בקריאת ' + f.name + ': ' + e.message);
      }
    }
    autoYears();
    render();
  }
  function autoYears() {
    if (state.years.length) return;
    const all = new Set();
    state.ledgers.forEach((l) => PL.yearsInRows(l.rows).forEach((y) => all.add(y)));
    const ys = Array.from(all).sort();
    if (ys.length) state.years = [ys[ys.length - 1]];
  }
  function availableYears() {
    const s = new Set(KNOWN_YEARS);
    state.customYears.forEach((y) => s.add(y));
    state.ledgers.forEach((l) => PL.yearsInRows(l.rows).forEach((y) => s.add(y)));
    return Array.from(s).sort();
  }

  /* ---------- הורדה ---------- */
  function download(buffer, name) {
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  const fileSafe = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, ' ').trim();
  async function exportInterest(ctx) {
    const { wb } = EI.buildInterestWorkbook(ExcelJS, ctx);
    const buf = await wb.xlsx.writeBuffer();
    download(buf, 'notional-interest-workpaper_' + state.years.join('-') + '.xlsx');
  }

  /* ---------- רינדור ---------- */
  function render() {
    const app = $('#app');
    const focus = document.activeElement;
    const fid = focus && focus.dataset && focus.dataset.fid;
    const scrollY = window.scrollY;
    const ctx = state.ledgers.length ? PL.buildContext(state) : null;
    state._ctx = ctx;
    app.innerHTML = [
      tabsHtml(),
      state.tab === 'interest' ? interestTab(ctx) : (window.AnalysisUI ? window.AnalysisUI.render(state, ctx, { esc, fmt, fmt0 }) : ''),
    ].join('');
    bind(ctx);
    window.scrollTo(0, scrollY);
    if (fid) { const el = document.querySelector('[data-fid="' + fid + '"]'); if (el) { el.focus(); try { el.setSelectionRange(el.value.length, el.value.length); } catch (e) { /* לא כל שדה תומך */ } } }
  }

  function tabsHtml() {
    const t = (id, label) => `<button class="tab ${state.tab === id ? 'active' : ''}" data-tab="${id}">${label}</button>`;
    return `<div class="tabs">${t('interest', 'ריבית רעיונית (3ט / 3י / 3ט1)')}${window.AnalysisUI ? t('analysis', 'בודק משיכות בעלים וניתוח כרטסת') : ''}</div>`;
  }

  function interestTab(ctx) {
    return [stepDetails(), stepUpload(), stepSettings(), stepResults(ctx)].join('');
  }

  function stepDetails() {
    return `<section class="step">
      <h2><span class="num">1</span> פרטי נייר העבודה</h2>
      <p class="hint">השמות האלה יופיעו בכותרת של כל גיליון באקסל.</p>
      <div class="grid">
        <label class="f">שם החברה<input type="text" data-fid="company" data-k="company" value="${esc(state.company)}" placeholder="למשל: אלפא בע&quot;מ"></label>
        <label class="f">מי הכין את נייר העבודה<input type="text" data-fid="preparer" data-k="preparer" value="${esc(state.preparer)}" placeholder="שם המכין"></label>
      </div>
    </section>`;
  }

  function stepUpload() {
    const cards = state.ledgers.map(ledgerCard).join('');
    return `<section class="step">
      <h2><span class="num">2</span> העלאת כרטסות</h2>
      <p class="hint">אפשר להעלות כמה כרטסות יחד. כרטסות עם אותו שם בשדה "קבץ לפי" יאוחדו לנייר עבודה אחד של אותו בעל מניות. כרטסות עם שמות שונים יקבלו כל אחת נייר עבודה נפרד. קבצים נתמכים: xlsx, xls, csv.</p>
      <div class="drop" id="drop" tabindex="0" role="button"><b>גרור לכאן קבצי כרטסת או לחץ לבחירה</b><div class="small">הקבצים לא עוזבים את המחשב</div></div>
      <input type="file" id="file" multiple accept=".xls,.xlsx,.xlsm,.csv" hidden>
      ${cards}
    </section>`;
  }

  function mappingSelect(l, key, label) {
    const headerRow = l.mapping.headerRow >= 0 ? l.grid[l.mapping.headerRow] || [] : [];
    const maxCol = Math.max(15, ...l.grid.slice(0, 50).map((r) => (r || []).length));
    let opts = '<option value="">ללא</option>';
    for (let i = 0; i < maxCol; i++) {
      const h = headerRow[i] != null && String(headerRow[i]).trim() ? ' - ' + String(headerRow[i]).trim().slice(0, 18) : '';
      opts += `<option value="${i}" ${l.mapping.cols[key] === i ? 'selected' : ''}>${colLabel(i)}${esc(h)}</option>`;
    }
    return `<label class="f">${label}<select data-lmap="${key}" data-id="${l.id}">${opts}</select></label>`;
  }

  function ledgerCard(l) {
    const dates = l.rows.filter((r) => r.date != null).map((r) => r.date);
    const range = dates.length ? Calc.fmtDate(Math.min(...dates)) + ' עד ' + Calc.fmtDate(Math.max(...dates)) : 'אין תאריכים';
    const typeOpts = Object.entries(PL.TYPES).map(([k, v]) => `<option value="${k}" ${l.type === k ? 'selected' : ''}>${v.label}</option>`).join('');
    const sheetOpts = l.sheetNames.map((n) => `<option ${n === l.sheetName ? 'selected' : ''}>${esc(n)}</option>`).join('');
    const auto = l.rows.filter((r) => r.autoExcluded);
    const groups = Array.from(new Set(state.ledgers.map((x) => x.group)));
    const sec = (key, label) => {
      const cur = l[key] || '';
      const options = key === 'debitSection'
        ? [['', 'לפי סוג הצד'], ['s3t', '3(ט)'], ['s3t1', '3(ט1)'], ['none', 'ללא חישוב']]
        : [['', 'לפי סוג הצד'], ['s3y', '3(י)'], ['none', 'ללא חישוב']];
      return `<label class="f">${label}<select data-lf="${key}" data-id="${l.id}">${options.map(([v, t]) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>`;
    };
    const opening = state.years.map((y) => {
      const od = Calc.deriveOpening(l.rows, y);
      const v = l.openingOverride[y];
      return `<label class="f">יתרת פתיחה ${y} (חובה חיובי, זכות שלילי)<input type="number" step="0.01" data-fid="op${l.id}_${y}" data-open="${y}" data-id="${l.id}" value="${v == null ? '' : v}" placeholder="אוטומטי: ${fmt(od.value)}"><small>${esc(od.source)}</small></label>`;
    }).join('');
    const noteT = (PL.TYPES[l.type] || {}).note;
    return `<div class="card" data-card="${l.id}">
      <div class="row" style="justify-content:space-between"><h3>${esc(l.fileName)} <span class="pill ok">${l.rows.length} שורות</span> <span class="small">${range}</span></h3>
      <button class="danger mini" data-rm="${l.id}">הסר כרטסת</button></div>
      <div class="grid">
        <label class="f">גיליון בקובץ<select data-lf="sheetName" data-id="${l.id}">${sheetOpts}</select></label>
        <label class="f">מי הצד הקשור?<select data-lf="type" data-id="${l.id}">${typeOpts}</select></label>
        <label class="f">קבץ לפי (שם בעל המניות)<input type="text" list="grp" data-fid="grp${l.id}" data-lf="group" data-id="${l.id}" value="${esc(l.group)}"><small>שם זהה בכמה כרטסות = נייר עבודה משותף</small></label>
        ${sec('debitSection', 'סעיף ליתרת חובה')}
        ${sec('creditSection', 'סעיף ליתרת זכות')}
        ${opening}
      </div>
      <datalist id="grp">${groups.map((g) => `<option value="${esc(g)}">`).join('')}</datalist>
      ${noteT ? `<div class="alert warn">${esc(noteT)}</div>` : ''}
      <label class="chk"><input type="checkbox" data-lf="balNegIsDebit" data-id="${l.id}" ${l.balNegIsDebit ? 'checked' : ''}> בכרטסת שלי יתרה שלילית (בסוגריים) היא יתרת חובה, כלומר בעל המניות חייב לחברה</label>
      ${l.mapping.cols.debit == null && l.mapping.cols.credit == null ? `<label class="chk"><input type="checkbox" data-lf="amountPosIsDebit" data-id="${l.id}" ${l.amountPosIsDebit ? 'checked' : ''}> בעמודת הסכום, סכום חיובי הוא חובה (רלוונטי רק אם אין עמודת יתרה)</label>` : ''}
      <details><summary>מיפוי עמודות ${l.mapping.detected ? '(זוהה אוטומטית)' : '(לא זוהו כותרות, נבחרו עמודות K,M,N,O לפי רם. יש לאמת)'}</summary>
        <div class="grid">${mappingSelect(l, 'date', 'תאריך')}${mappingSelect(l, 'desc', 'תיאור')}${mappingSelect(l, 'ref', 'אסמכתא')}${mappingSelect(l, 'debit', 'חובה')}${mappingSelect(l, 'credit', 'זכות')}${mappingSelect(l, 'amount', 'סכום תנועה')}${mappingSelect(l, 'balance', 'יתרה')}</div>
      </details>
      ${auto.length ? `<div class="alert warn">זוהו ${auto.length} שורות ריבית קיימת בכרטסת (ריבית 3ט / 3י). הן הוחרגו מהחישוב כדי לא לחשב ריבית על ריבית. אפשר לשנות בטבלת השורות.</div>` : ''}
      ${l.issues.length ? `<details><summary>${l.issues.length} שורות שדולגו בקריאה</summary><ul class="small">${l.issues.slice(0, 50).map((i) => `<li>שורה ${i.row}: ${esc(i.msg)}</li>`).join('')}</ul></details>` : ''}
      <details><summary>הצג את שורות הכרטסת שנקראו (סימון "הוחרג" מוציא שורה מהחישוב)</summary>${rowsTable(l)}</details>
    </div>`;
  }

  function rowsTable(l) {
    const shown = l.rows.slice(0, 600);
    return `<div class="scroll" style="max-height:340px;overflow:auto"><table class="t"><tr><th>הוחרג</th><th>שורה</th><th>תאריך</th><th>תיאור</th><th>חובה</th><th>זכות</th></tr>${shown.map((r) => `<tr><td class="l"><input type="checkbox" data-excl="${l.id}:${r.seq}" ${r.excluded ? 'checked' : ''}></td><td>${r.srcRow}</td><td>${r.kind === 'opening' && r.date == null ? 'פתיחה' : Calc.fmtDate(r.date)}</td><td class="l">${esc(r.desc)}</td><td>${fmt(r.debit)}</td><td>${fmt(r.credit)}</td></tr>`).join('')}</table></div>${l.rows.length > 600 ? '<div class="small">מוצגות 600 שורות ראשונות</div>' : ''}`;
  }

  function stepSettings() {
    const years = availableYears();
    const yearChecks = years.map((y) => `<label class="chk"><input type="checkbox" data-year="${y}" ${state.years.includes(y) ? 'checked' : ''}> ${y}</label>`).join('');
    const rateRows = state.years.map((y) => {
      const def = Calc.DEFAULT_RATES[y] || {};
      const man = state.rates[y] || {};
      const cell = (k, step) => {
        const missing = def[k] == null && (man[k] === '' || man[k] == null) && (k === 's3t' || k === 's3y' || k === 'vat');
        return `<td><input class="rate ${missing ? 'need' : ''}" type="number" step="${step || 0.01}" data-fid="r${y}${k}" data-rate="${y}:${k}" value="${man[k] == null ? '' : man[k]}" placeholder="${def[k] != null ? def[k] : 'הזן ידנית'}"></td>`;
      };
      return `<tr><td class="l"><b>${y}</b></td>${cell('s3t')}${cell('s3y')}${cell('s3t1')}${cell('vat', 0.1)}${cell('cpi')}<td class="l small">${def.source ? esc(def.source) : 'שנה ללא נתונים מובנים: יש להזין את השיעורים מהחוזר הרשמי'}</td></tr>`;
    }).join('');
    return `<section class="step">
      <h2><span class="num">3</span> שנות מס ושיעורים</h2>
      <p class="hint">2025 ו-2026 מוזנים מראש. לשנים אחרות (2027, 2028 ואילך) מזינים ידנית. שדה ריק בטבלה משתמש בערך המוצג באפור. הזנה ידנית גוברת על הערך המובנה.</p>
      <div class="row">${yearChecks}<label class="f" style="width:140px">הוסף שנה<input type="number" min="2000" max="2100" data-fid="addyear" id="addyear" placeholder="2027"></label><button id="addyearbtn">הוסף</button></div>
      <div class="scroll"><table class="t" style="margin-top:12px"><tr><th>שנה</th><th>ריבית 3(ט) יתרת חובה %</th><th>ריבית 3(י) יתרת זכות %</th><th>ריבית 3(ט1) % (ידני)</th><th>מע"מ %</th><th>עליית מדד שנתית % (להצמדה 3י)</th><th>מקור</th></tr>${rateRows || '<tr><td colspan="7" class="l">בחר שנה</td></tr>'}</table></div>
      <div class="alert warn">שיעורי 2026 (6.53% ו-4.9%) נלקחו מפרסומים ציבוריים ולא אומתו מול החוזר המקורי של רשות המסים. יש לאמת לפני הסתמכות. שיעור 3(ט1) אינו מובנה ויש להזינו ידנית.</div>
      <details><summary>שיטת החישוב והגדרות מתקדמות</summary>
        <div class="grid" style="margin-top:8px">
          <label class="f">ספירת ימים<select data-set="daysMethod"><option value="ram" ${state.settings.daysMethod === 'ram' ? 'selected' : ''}>רם: מתנועה אחרונה בחודש קודם עד תנועה אחרונה בחודש</option><option value="calendar" ${state.settings.daysMethod === 'calendar' ? 'selected' : ''}>ימי לוח בכל חודש</option></select></label>
        </div>
        <label class="chk"><input type="checkbox" data-setb="grossIncludesVat" ${state.settings.grossIncludesVat ? 'checked' : ''}> ריבית מחושבת כוללת מע"מ ומפורקת בסוף (כפי שרם ניהול פלוס עושה)</label>
        <label class="chk"><input type="checkbox" data-setb="extendToYearEnd" ${state.settings.extendToYearEnd ? 'checked' : ''}> להאריך את התקופה האחרונה עד 31/12, כך שסך הימים יהיה 365/366</label>
        <label class="chk"><input type="checkbox" data-setb="vatOnDebit" ${state.settings.vatOnDebit ? 'checked' : ''}> מע"מ על ריבית יתרת חובה 3(ט)</label>
        <label class="chk"><input type="checkbox" data-topb="vatOn3t1" ${state.vatOn3t1 ? 'checked' : ''}> מע"מ גם על 3(ט1) (לא מסומן כברירת מחדל, יש לאמת)</label>
        <label class="chk"><input type="checkbox" data-topb="bookCreditInterest" ${state.bookCreditInterest ? 'checked' : ''}> לרשום פקודת יומן גם לריבית 3(י), ולא רק להצמדה</label>
        <div class="grid" style="margin-top:8px">
          ${[['shareholder', 'חשבון בעלי מניות'], ['incomeD', 'חשבון הכנסות מימון'], ['vat', 'חשבון מע"מ עסקאות'], ['expenseC', 'חשבון הוצאות ריבית 3(י)'], ['linkage', 'חשבון הפרשי הצמדה']].map(([k, t]) => `<label class="f">${t}<input type="text" data-fid="acc${k}" data-acc="${k}" value="${esc(state.accounts[k])}"></label>`).join('')}
        </div>
      </details>
    </section>`;
  }

  function kpi(k, v) { return `<div class="kpi"><div class="k">${k}</div><div class="v">${v}</div></div>`; }

  function stepResults(ctx) {
    if (!ctx) return `<section class="step"><h2><span class="num">4</span> תוצאות והורדה</h2><p class="hint">העלה כרטסת כדי לראות תוצאות.</p></section>`;
    let body = '';
    if (!state.years.length) body += '<div class="alert bad">בחר לפחות שנת מס אחת בשלב 3.</div>';
    ctx.blocked.forEach((b) => { body += `<div class="alert bad"><b>${esc(b.group)}, ${b.year}:</b> חסרים שיעורים (${b.missing.map((m) => ({ s3t: '3(ט)', s3y: '3(י)', s3t1: '3(ט1)', vat: 'מע"מ' }[m])).join(', ')}). יש להזין ידנית בשלב 3 כדי לחשב.</div>`; });
    ctx.groups.forEach((g) => {
      body += `<div class="card"><h3>${esc(g.name)} <span class="pill ok">${esc(g.typeLabel)}</span></h3><div class="small">מקור: ${g.ledgers.map(esc).join(' ; ')}</div>`;
      if (!g.years.length) body += '<div class="small">אין תוצאות לשנה שנבחרה.</div>';
      g.years.forEach((yb) => { body += yearBlock(g, yb); });
      body += '</div>';
    });
    const ready = ctx.groups.some((g) => g.years.length);
    return `<section class="step">
      <h2><span class="num">4</span> תוצאות והורדה</h2>
      <p class="hint">בדוק את הבקרות שמתחת לכל טבלה לפני הורדה. הקובץ שיורד מכיל נוסחאות חיות, כך שאפשר לשנות פרמטר באקסל והחישוב יתעדכן.</p>
      ${body}
      <div class="actions">
        <button class="primary big" id="dl-interest" ${ready ? '' : 'disabled'}>הורד נייר עבודה: ריבית רעיונית (אקסל)</button>
      </div>
    </section>`;
  }

  function yearBlock(g, yb) {
    const t = yb.res.totals;
    const dl = t.debitKey === 's3t1' ? '3(ט1)' : '3(ט)';
    const warns = [];
    if (t.days !== t.diy && state.settings.daysMethod === 'ram') warns.push('סך הימים ' + t.days + ' שונה מ-' + t.diy + '. בדוק תנועות אחרונות בדצמבר או הפעל הארכה עד 31/12.');
    if (!yb.openingFound) warns.push('לא נמצאה יתרת פתיחה בכרטסת. יש להזין ידנית בכרטסת למעלה, אחרת היא נחשבת אפס.');
    if (yb.recon.diffs.length) warns.push('יתרת הכרטסת בקובץ אינה תואמת לצבירת התנועות ב-' + yb.recon.diffs.length + ' שורות (למשל שורה ' + yb.recon.diffs[0].srcRow + '). ייתכן שסימן היתרה הפוך או שחסרה עמודה.');
    if (yb.excludedRows.length) warns.push('הוחרגו ' + yb.excludedRows.length + ' שורות ריבית קיימת, בסכום נטו ' + fmt(yb.excludedNet) + '.');
    if (t.debitKey && !t.rateD) warns.push('שיעור ' + dl + ' אינו מוגדר.');
    if (t.creditKey && t.linkageRaw === 0 && yb.res.months.some((m) => m.side === 'C') && !t.cpi) warns.push('קיימת יתרת זכות אך לא הוזנה עליית מדד להצמדה 3(י).');
    const cmp = yb.cmp;
    const diffPct = t.grossD ? Math.abs(t.grossD - cmp.interestD) / t.grossD : 0;
    const entries = EI.journalEntries(g, yb, state.accounts);
    const rows = yb.res.months.map((m) => `<tr><td class="l">${m.month}/${yb.year}</td><td>${fmt(m.base)}</td><td>${fmt(m.debit)}</td><td>${fmt(m.credit)}</td><td class="${m.close < 0 ? 'neg' : ''}">${fmt(m.close)}</td><td>${m.days}</td><td class="l">${m.side === 'D' ? 'חובה' : m.side === 'C' ? 'זכות' : '-'}</td><td>${fmt(m.interestD)}</td><td>${fmt(m.interestC)}</td><td>${fmt(m.linkage)}</td></tr>`).join('');
    return `<div style="margin:16px 0;border-top:2px solid var(--line);padding-top:12px">
      <h3>שנת ${yb.year}</h3>
      ${warns.map((w) => `<div class="alert warn">${esc(w)}</div>`).join('')}
      <div class="kpis">
        ${kpi('יתרת פתיחה', fmt(yb.opening) + ' ' + (yb.opening >= 0 ? '(חובה)' : '(זכות)'))}
        ${kpi('ריבית ' + dl + ' ללא מע"מ', fmt0(t.netD))}
        ${kpi('מע"מ', fmt0(t.vatD))}
        ${kpi('סה"כ כולל מע"מ', fmt0(t.totalD))}
        ${kpi('ריבית 3(י) / הצמדה', fmt0(t.interestC) + ' / ' + fmt0(t.linkage))}
        ${kpi('יתרת סגירה', fmt(t.closing))}
      </div>
      <details open><summary>טבלה חודשית</summary><div class="scroll"><table class="t"><tr><th>חודש</th><th>יתרת פתיחה לחישוב</th><th>חובה</th><th>זכות</th><th>יתרת סגירה</th><th>ימים</th><th>סוג</th><th>ריבית ${dl}</th><th>ריבית 3(י)</th><th>הצמדה</th></tr>
        <tr class="tot"><td class="l">סה"כ</td><td></td><td>${fmt(t.debit)}</td><td>${fmt(t.credit)}</td><td>${fmt(t.closing)}</td><td>${t.days}</td><td></td><td>${fmt(t.grossD)}</td><td>${fmt(t.interestCRaw)}</td><td>${fmt(t.linkageRaw)}</td></tr>${rows}</table></div></details>
      <details><summary>פקודת יומן מוצעת</summary>${entries.length ? `<table class="t"><tr><th>חשבון חובה</th><th>חשבון זכות</th><th>סכום</th><th>פרטים</th></tr>${entries.map((e) => `<tr><td class="l">${esc(e.dr)}</td><td class="l">${esc(e.cr)}</td><td>${fmt0(e.amount)}</td><td class="l">${esc(e.note)}</td></tr>`).join('')}</table>` : '<div class="small">אין פקודות לשנה זו.</div>'}</details>
      <details><summary>בקרות והשוואה</summary><ul class="small">
        <li>סך ימים שנספרו: ${t.days} מתוך ${t.diy}</li>
        <li>התאמת יתרות הכרטסת: ${yb.recon.checked} שורות נבדקו, ${yb.recon.diffs.length} סטיות</li>
        <li>השוואה לשיטת יתרה יומית בפועל: ${fmt(cmp.interestD)} מול ${fmt(t.grossD)} לפי רם (הפרש ${fmt(t.grossD - cmp.interestD)}${diffPct > 0.05 ? ', מעל 5%, כדאי להבין את הסיבה' : ''})</li>
        ${yb.extClosing != null ? `<li>יתרת סגירה בכרטסת ${fmt(yb.extClosing)} מול מחושבת ${fmt(t.closing + yb.excludedNet)} (כולל שורות שהוחרגו)</li>` : ''}
      </ul></details>
    </div>`;
  }

  /* ---------- קישור אירועים ---------- */
  function bind(ctx) {
    $$('[data-tab]').forEach((b) => b.addEventListener('click', () => { state.tab = b.dataset.tab; render(); }));
    const drop = $('#drop');
    if (drop) {
      const input = $('#file');
      drop.addEventListener('click', () => input.click());
      drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') input.click(); });
      input.addEventListener('change', () => addFiles(Array.from(input.files)));
      drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('over'));
      drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); addFiles(Array.from(e.dataTransfer.files)); });
    }
    $$('[data-k]').forEach((el) => el.addEventListener('input', () => { state[el.dataset.k] = el.value; save(); }));
    $$('[data-acc]').forEach((el) => el.addEventListener('change', () => { state.accounts[el.dataset.acc] = el.value; save(); render(); }));
    $$('[data-year]').forEach((el) => el.addEventListener('change', () => {
      const y = Number(el.dataset.year);
      state.years = el.checked ? Array.from(new Set(state.years.concat(y))).sort() : state.years.filter((v) => v !== y);
      render();
    }));
    const addBtn = $('#addyearbtn');
    if (addBtn) addBtn.addEventListener('click', () => {
      const y = Number($('#addyear').value);
      if (!y || y < 2000 || y > 2100) return toast('הזן שנה תקינה');
      if (!state.customYears.includes(y)) state.customYears.push(y);
      if (!state.years.includes(y)) state.years = state.years.concat(y).sort();
      save(); render();
    });
    $$('[data-rate]').forEach((el) => el.addEventListener('change', () => {
      const [y, k] = el.dataset.rate.split(':');
      state.rates[y] = state.rates[y] || {};
      state.rates[y][k] = el.value === '' ? '' : Number(el.value);
      save(); render();
    }));
    $$('[data-set]').forEach((el) => el.addEventListener('change', () => { state.settings[el.dataset.set] = el.value; save(); render(); }));
    $$('[data-setb]').forEach((el) => el.addEventListener('change', () => { state.settings[el.dataset.setb] = el.checked; save(); render(); }));
    $$('[data-topb]').forEach((el) => el.addEventListener('change', () => { state[el.dataset.topb] = el.checked; save(); render(); }));
    const find = (id) => state.ledgers.find((l) => l.id === Number(id));
    $$('[data-rm]').forEach((el) => el.addEventListener('click', () => { state.ledgers = state.ledgers.filter((l) => l.id !== Number(el.dataset.rm)); render(); }));
    $$('[data-lf]').forEach((el) => el.addEventListener('change', () => {
      const l = find(el.dataset.id);
      const k = el.dataset.lf;
      l[k] = el.type === 'checkbox' ? el.checked : el.value;
      if (k === 'sheetName') { l.mapping = null; l._manualExcl = new Map(); reparse(l); }
      if (k === 'balNegIsDebit' || k === 'amountPosIsDebit') reparse(l);
      render();
    }));
    $$('[data-lmap]').forEach((el) => el.addEventListener('change', () => {
      const l = find(el.dataset.id);
      l.mapping.cols[el.dataset.lmap] = el.value === '' ? null : Number(el.value);
      l.mapping.detected = true;
      reparse(l); render();
    }));
    $$('[data-open]').forEach((el) => el.addEventListener('change', () => {
      const l = find(el.dataset.id);
      l.openingOverride[el.dataset.open] = el.value === '' ? null : Number(el.value);
      render();
    }));
    $$('[data-excl]').forEach((el) => el.addEventListener('change', () => {
      const [id, seq] = el.dataset.excl.split(':');
      const l = find(id);
      const r = l.rows.find((x) => x.seq === Number(seq));
      r.excluded = el.checked;
      l._manualExcl.set(r.srcRow + ':' + r.seq, el.checked);
      render();
    }));
    const dl = $('#dl-interest');
    if (dl) dl.addEventListener('click', async () => { try { await exportInterest(ctx); toast('הקובץ ירד'); } catch (e) { console.error(e); toast('שגיאה ביצירת הקובץ: ' + e.message); } });
    if (window.AnalysisUI) window.AnalysisUI.bind(state, ctx, { render, toast, download, fileSafe, find });
  }

  window.__render = render;
  load();
  render();
})();
