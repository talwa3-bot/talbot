import { MESSAGES } from "./i18n.js";

const S = { user: null, me: null, dims: null, lang: "he-IL" };
try { S.user = localStorage.getItem("ll.user"); S.lang = localStorage.getItem("ll.lang") || "he-IL"; } catch {}
const $ = (sel, el = document) => el.querySelector(sel);
// Clear the hash without firing hashchange, then render once.
function resetRoute() { try { history.replaceState(null, "", location.pathname + location.search); } catch {} route(); }
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const t = (k, vars = {}) => (MESSAGES[S.lang][k] ?? k).replace(/\{(\w+)\}/g, (_, n) => vars[n] ?? "");
const ltr = (s) => `<bdi class="ltr" dir="ltr">${esc(s)}</bdi>`;
const money = (s, ccy = "USD") => (s == null ? "" : ltr(new Intl.NumberFormat(S.lang, { style: "currency", currency: ccy, minimumFractionDigits: 2 }).format(Number(s))));
const pct = (s) => (s === "n/a" ? esc(t("na")) : ltr(new Intl.NumberFormat(S.lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(s)) + "%"));
const monthLabel = (p) => { const [y, m] = p.split("-").map(Number); return `${new Intl.DateTimeFormat(S.lang, { month: "long", year: "numeric", timeZone: "UTC" }).format(Date.UTC(y, m - 1, 1))} (FY${y} P${String(m).padStart(2, "0")})`; };
const periodLabel = (a, b) => (a === b ? monthLabel(a) : `${monthLabel(a)} – ${monthLabel(b)}`);
const errText = (e) => t(`E_${e.code}`) !== `E_${e.code}` ? t(`E_${e.code}`) : e.message;
// Server text keeps canonical numbers; display formats them per locale and isolates them for bidi.
const prose = (text) => esc(text)
  .replace(/(\d{4}-\d{2})\.\.(\d{4}-\d{2})/g, (_, a, b) => periodLabel(a, b))
  .replace(/(?<![\d-])(\d{4}-\d{2})(?![\d-])/g, (_, a) => monthLabel(a))
  .replace(/-?\d+\.\d{2}(?!\d)/g, (n) => ltr(new Intl.NumberFormat(S.lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n))).replace(/&amp;/g, "&"));
const badge = (dir) => { const cls = { favorable: "good", unfavorable: "bad", neutral: "neutral" }[dir] ?? "warn"; const icon = { favorable: "✓", unfavorable: "▲", neutral: "=" }[dir] ?? "?"; return `<span class="badge ${cls}"><span aria-hidden="true">${icon}</span>${esc(t("dir_" + dir))}</span>`; };

async function api(path, { method = "GET", body, write = false } = {}) {
  const headers = { authorization: `Bearer demo:${S.user}` };
  if (body) headers["content-type"] = "application/json";
  if (write) headers["idempotency-key"] = crypto.randomUUID();
  const r = await fetch(`/api/v1${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(data.message || r.statusText); e.code = data.code; e.status = r.status; throw e; }
  return data;
}

function toast(msg, error = false) {
  const el = $("#toast"); el.textContent = msg; el.className = "toast" + (error ? " error" : ""); el.hidden = false;
  clearTimeout(toast.h); toast.h = setTimeout(() => (el.hidden = true), 6000);
}
const busy = (btn, on) => { if (!btn) return; btn.disabled = on; btn.setAttribute("aria-busy", on); if (on) { btn.dataset.label = btn.innerHTML; btn.innerHTML = `<span class="spinner" aria-hidden="true"></span> ${esc(t("working"))}`; } else if (btn.dataset.label) btn.innerHTML = btn.dataset.label; };
async function guarded(btn, fn) { busy(btn, true); try { return await fn(); } catch (e) { toast(errText(e), true); } finally { busy(btn, false); } }

function applyLang() {
  const he = S.lang === "he-IL";
  document.documentElement.lang = he ? "he" : "en";
  document.documentElement.dir = he ? "rtl" : "ltr";
  $("#lang").textContent = he ? "English" : "עברית";
  $("#lang").setAttribute("aria-label", he ? "Switch to English" : "מעבר לעברית");
  document.querySelectorAll("[data-i18n]").forEach((el) => (el.textContent = t(el.dataset.i18n)));
  $("#nav").setAttribute("aria-label", t("nav"));
  const demo = $("#demo"); if (demo) { demo.hidden = !window.LEDGERLENS_DEMO; demo.textContent = t("demo_banner"); }
}

const ROUTES = {
  ask: { roles: ["cfo", "fpa", "controller", "department_manager"], render: renderAsk },
  close: { roles: ["cfo", "fpa", "controller", "accountant"], render: renderClose },
  explore: { roles: ["cfo", "fpa", "controller", "department_manager"], render: renderExplore },
  data: { roles: ["admin"], render: renderData },
  audit: { roles: ["admin", "cfo", "controller"], render: renderAudit },
};

async function boot() {
  applyLang();
  $("#lang").onclick = () => { S.lang = S.lang === "he-IL" ? "en-US" : "he-IL"; try { localStorage.setItem("ll.lang", S.lang); } catch {} applyLang(); route(); };
  $("#logout").onclick = () => { S.user = null; S.me = null; try { localStorage.removeItem("ll.user"); } catch {} resetRoute(); };
  $("#drawer-close").onclick = () => $("#drawer").close();
  window.addEventListener("hashchange", route);
  route();
}

let routeSeq = 0;
async function route() {
  const seq = ++routeSeq; // only the latest navigation may render
  const main = $("#main");
  if (!S.user) return renderLogin(main);
  try {
    if (!S.me) { const me = await api("/me"), dims = await api("/dimensions"); if (seq !== routeSeq) return; S.me = me; S.dims = dims; }
  } catch (e) { S.user = null; return renderLogin(main); }
  if (seq !== routeSeq) return;
  const allowed = Object.keys(ROUTES).filter((k) => ROUTES[k].roles.includes(S.me.role));
  let name = location.hash.replace(/^#\/?/, "") || allowed[0];
  if (!allowed.includes(name)) name = allowed[0];
  $("#nav").hidden = false; $("#logout").hidden = false;
  $("#nav").innerHTML = allowed.map((k) => `<a href="#${k}" ${k === name ? 'aria-current="page"' : ""}>${esc(t("nav_" + k))}</a>`).join("");
  renderContext();
  main.innerHTML = "";
  await ROUTES[name].render(main);
  main.focus({ preventScroll: true });
  document.title = `${t("nav_" + name)} · LedgerLens`;
}

function renderContext() {
  const d = S.dims, el = $("#context");
  const plan = d.plan_versions[0];
  const periods = d.current_snapshot?.periods ?? [];
  el.hidden = false;
  el.innerHTML = [
    `${esc(t("ctx_entity"))}: <b>${ltr(d.entities.join(", "))}</b>`,
    periods.length ? `${esc(t("ctx_periods"))}: <b>${esc(periodLabel(periods[0], periods.at(-1)))}</b>` : "",
    plan ? `${esc(t("ctx_budget"))}: <b>${esc(plan.name)}</b>` : "",
    `${esc(t("ctx_currency"))}: <b>${ltr(plan?.base_currency ?? "USD")}</b>`,
    d.current_snapshot ? `${esc(t("ctx_refresh"))}: <b>${esc(new Intl.DateTimeFormat(S.lang, { dateStyle: "medium", timeStyle: "short" }).format(new Date(d.current_snapshot.imported_at)))}</b>` : "",
    `<span>${esc(t("role_" + S.me.role))}</span>`,
  ].filter(Boolean).join(" <span aria-hidden='true'>·</span> ");
}

async function renderLogin(main) {
  $("#nav").hidden = true; $("#logout").hidden = true; $("#context").hidden = true;
  const users = await fetch("/api/v1/demo-users").then((r) => r.json()).catch(() => []);
  const roleOf = { cfo: "cfo", controller: "controller", fpa: "fpa", accountant: "accountant", "mgr-sales": "department_manager", admin: "admin" };
  main.innerHTML = `<h1>${esc(t("login_title"))}</h1><p class="sub">${esc(t("login_sub"))}</p>
    <div class="users" role="list">${users.map((u) => `<button class="user" role="listitem" data-u="${esc(u)}"><strong>${esc(t("role_" + roleOf[u]))}</strong><span>${esc(t("role_" + roleOf[u] + "_d"))}</span></button>`).join("")}</div>`;
  main.querySelectorAll("[data-u]").forEach((b) => (b.onclick = () => {
    S.user = b.dataset.u; try { localStorage.setItem("ll.user", S.user); } catch {}
    resetRoute(); // starts on the role's first page; language stays as chosen
  }));
  document.title = "LedgerLens";
}

// Sandboxed viewers block downloads, so the static demo shows file contents with a copy button.
function showText(title, text) {
  const d = $("#drawer"); $("#drawer-title").textContent = title;
  $("#drawer-body").innerHTML = `<p><button type="button" id="copytxt">${esc(t("copy"))}</button></p><pre class="ltr" dir="ltr" style="white-space:pre-wrap;overflow-x:auto"><code id="txt">${esc(text)}</code></pre>`;
  $("#copytxt").onclick = async () => { try { await navigator.clipboard.writeText(text); toast(t("copied")); } catch { const r = document.createRange(); r.selectNodeContents($("#txt")); getSelection().removeAllRanges(); getSelection().addRange(r); } };
  d.showModal();
}
async function deliverFile(url, filename, title) {
  const r = await fetch(url, { headers: { authorization: `Bearer demo:${S.user}` } });
  if (!r.ok) throw Object.assign(new Error("export failed"), await r.json());
  const text = (await r.text()).replace(/^\uFEFF/, "");
  if (window.LEDGERLENS_DEMO) return showText(title, text);
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["\uFEFF" + text], { type: "text/csv" })); a.download = filename; a.click();
}

// ---------------- Ask ----------------
async function renderAsk(main) {
  main.innerHTML = `<h1>${esc(t("ask_title"))}</h1><p class="sub">${esc(t("ask_sub"))}</p>
  <form class="card" id="askf" role="search">
    <label for="q">${esc(t("ask_label"))}</label>
    <div class="ask-box"><input id="q" name="q" autocomplete="off" placeholder="${esc(t("ask_ph"))}" required maxlength="500"><button id="askb">${esc(t("ask_btn"))}</button></div>
    <div class="chips" aria-label="${esc(t("examples"))}">${["ex1", "ex2", "ex3", "ex4"].map((k) => `<button type="button" class="chip" data-ex="${esc(t(k))}">${esc(t(k))}</button>`).join("")}</div>
  </form>
  <section id="answer" aria-live="polite"></section>`;
  const f = $("#askf"), q = $("#q");
  main.querySelectorAll("[data-ex]").forEach((b) => (b.onclick = () => { q.value = b.dataset.ex; f.requestSubmit(); }));
  f.onsubmit = (ev) => { ev.preventDefault(); guarded($("#askb"), async () => {
    const a = await api("/analysis/ask", { method: "POST", body: { question: q.value, locale: S.lang } });
    renderAnswer($("#answer"), a);
  }); };
  q.focus();
}

function renderAnswer(el, a) {
  if (a.status !== "answer") {
    el.innerHTML = `<div class="card"><h2>${esc(t(a.status))}</h2><div class="notice">${esc(a.error_code ? t("E_" + a.error_code) : a.clarification)}</div></div>`;
    $("#q").focus(); return;
  }
  const m = a.meta, ccy = m.currency;
  const metric = a.ast.metric === "opex" ? (S.lang === "he-IL" ? "הוצאות תפעול" : "Operating expenses") : (S.lang === "he-IL" ? "הכנסות" : "Revenue");
  const max = Math.max(...a.table.map((r) => Math.max(Number(r.actual), Number(r.plan))), 1);
  const L = (k) => esc(t(k));
  const row = (r, label, foot = false) => `<tr role="row">
    <${foot ? "td role='cell'" : "th scope='row' role='rowheader'"}>${esc(label)}</${foot ? "td" : "th"}>
    <td role="cell" class="num" data-label="${L("col_actual")}">${money(r.actual, ccy)}</td><td role="cell" class="num" data-label="${L("col_plan")}">${money(r.plan, ccy)}</td>
    <td role="cell" class="num" data-label="${L("col_var")}">${money(r.variance, ccy)}</td><td role="cell" class="num" data-label="${L("col_pct")}">${pct(r.variance_pct)}</td>
    <td role="cell" data-label="${L("col_status")}">${badge(r.direction)}</td>
    <td role="cell">${foot ? "" : `<div class="bar" role="img" aria-label="${L("col_actual")} ${esc(r.actual)} / ${L("col_plan")} ${esc(r.plan)}"><span style="width:${Math.min(100, (Number(r.actual) / max) * 100)}%"></span></div>`}</td>
    <td role="cell"><button class="link" data-ev="${esc(r.result_id)}">${L("view_source")}<span class="sr"> ${esc(label)}</span></button></td></tr>`;
  el.innerHTML = `<div class="card">
    <p class="lead">${prose(a.lead)}</p>
    <div style="overflow-x:auto"><table class="resp" role="table">
      <caption>${esc(t("table_caption", { metric, period: periodLabel(m.period.from, m.period.to), currency: ccy }))}</caption>
      <thead><tr><th scope="col">${esc(t("col_dept"))}</th><th scope="col" class="num">${esc(t("col_actual"))}</th><th scope="col" class="num">${esc(t("col_plan"))}</th><th scope="col" class="num">${esc(t("col_var"))}</th><th scope="col" class="num">${esc(t("col_pct"))}</th><th scope="col">${esc(t("col_status"))}</th><th scope="col"><span class="sr">${esc(t("col_actual"))}</span></th><th scope="col">${esc(t("col_source"))}</th></tr></thead>
      <tbody>${a.table.map((r) => row(r, r.label)).join("")}</tbody>
      ${a.total ? `<tfoot>${row(a.total, t("total"), true)}</tfoot>` : ""}
    </table></div>
    ${a.total ? "" : `<div class="notice info">${esc(t("hidden_total"))}</div>`}
    <h3 style="margin-top:18px">${esc(t("why"))}</h3>
    <ul>${a.narrative.map((s) => `<li>${prose(s.text)} ${s.cites.filter((c) => c.startsWith("res_")).map((c) => `<button class="link" data-ev="${esc(c)}">${esc(t("view_source"))}</button>`).join("")}${s.cites.some((c) => !c.startsWith("res_")) ? ` <span class="badge warn">${esc(t("source_note"))}</span>` : ""}</li>`).join("")}</ul>
    <details><summary>${esc(t("assumptions"))}</summary><ul>${[...a.assumptions, ...a.limitations].map((x) => `<li>${esc(x)}</li>`).join("")}</ul></details>
    <details><summary>${esc(t("details"))}</summary><ul class="clean">
      <li>${esc(t("snapshot"))}: ${ltr(m.snapshot_id)}</li><li>${esc(t("plan_version"))}: ${ltr(m.plan_version_id)}</li>
      <li>${esc(t("as_of"))} ${esc(new Date(m.as_of).toLocaleString(S.lang))}</li><li>${esc(t("model"))}: ${ltr(a.narrative_source)}</li>
      <li><code class="ltr" dir="ltr">${esc(JSON.stringify(a.ast))}</code></li></ul></details>
  </div>`;
  el.querySelectorAll("[data-ev]").forEach((b) => (b.onclick = () => openEvidence(b.dataset.ev, b)));
  el.querySelector(".lead").setAttribute("tabindex", "-1"); el.querySelector(".lead").focus();
}

async function openEvidence(id, opener) {
  const d = $("#drawer"); $("#drawer-title").textContent = t("evidence_title");
  const body = $("#drawer-body"); body.innerHTML = `<span class="spinner" aria-hidden="true"></span>`;
  d.showModal(); d.addEventListener("close", () => opener?.focus(), { once: true });
  try {
    const ev = await api(`/analysis/${encodeURIComponent(id)}/evidence`);
    const tbl = (rows, cap) => `<table><caption>${esc(cap)}</caption><thead><tr><th scope="col">${esc(t("row_id"))}</th><th scope="col">${esc(t("period"))}</th><th scope="col">${esc(t("col_dept"))}</th><th scope="col">${esc(t("account"))}</th><th scope="col" class="num">${esc(t("amount"))}</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td>${ltr(r.source_row_id)}</td><td>${ltr(r.period)}</td><td>${esc(r.department)}</td><td>${ltr(r.account)}</td><td class="num">${money(r.amount, r.currency)}</td></tr>`).join("")}</tbody></table>`;
    body.innerHTML = `<p>${esc(t("formula"))}</p><p class="ltr" dir="ltr"><small>${esc(ev.result.result_id)} · ${esc(ev.result.formula_id)} · ${esc(ev.result.mapping_version)}</small></p>
      ${tbl(ev.actual_rows, t("actual_rows"))}<br>${tbl(ev.plan_rows, t("plan_rows"))}`;
  } catch (e) {
    body.innerHTML = `<div class="notice">${esc(e.code === "UNAUTHORIZED_SCOPE" ? t("evidence_denied") : errText(e))}</div>`;
  }
}

// ---------------- Close ----------------
async function renderClose(main) {
  const periods = S.dims.current_snapshot?.periods ?? ["2026-01"];
  main.innerHTML = `<h1>${esc(t("close_title"))}</h1><p class="sub">${esc(t("close_sub"))}</p>
    <div class="card row"><div><label for="cp">${esc(t("choose_period"))}</label><select id="cp">${periods.map((p) => `<option value="${p}">${esc(monthLabel(p))}</option>`).join("")}</select></div></div>
    <div id="closebody" aria-live="polite"></div>`;
  $("#cp").onchange = () => loadClose();
  await loadClose();
}
async function loadClose() {
  const period = $("#cp").value, el = $("#closebody");
  let c;
  try { c = await api(`/close/${period}/tasks`); } catch (e) { el.innerHTML = `<div class="notice">${esc(errText(e))}</div>`; return; }
  const role = S.me.role, done = c.tasks.filter((x) => x.status === "done").length;
  const canEdit = (task) => role === "controller" || (role === "accountant" && task.owner === S.me.user_id);
  const allOk = c.gates.every((g) => g.ok);
  let approvals = [];
  if (["controller", "cfo", "fpa"].includes(role)) approvals = await api(`/close/${period}/approvals`).catch(() => []);
  el.innerHTML = `<div class="grid">
    <section class="card" aria-labelledby="tasks-h"><h2 id="tasks-h">${esc(t("tasks"))}</h2>
      <p><progress max="${c.tasks.length}" value="${done}" aria-hidden="true" style="width:100%"></progress> ${esc(t("progress", { done, total: c.tasks.length }))}</p>
      ${c.tasks.map((task) => `<div class="task"><strong>${esc(t(task.title))}</strong>
        <div><label class="sr" for="s-${task.task_id}">${esc(t("state"))} ${esc(t(task.title))}</label><select id="s-${task.task_id}" ${canEdit(task) ? "" : "disabled"}>${["todo", "in_progress", "blocked", "done"].map((s) => `<option value="${s}" ${s === task.status ? "selected" : ""}>${esc(t("st_" + s))}</option>`).join("")}</select></div>
        <div class="row" style="gap:6px"><div><label class="sr" for="e-${task.task_id}">${esc(t("evidence_ref"))} ${esc(t(task.title))}</label><input id="e-${task.task_id}" placeholder="${esc(t("evidence_ref"))}" value="${esc(task.evidence_ref ?? "")}" ${canEdit(task) ? "" : "disabled"}></div>
        ${canEdit(task) ? `<button class="ghost" data-save="${task.task_id}" style="flex:0 0 auto">${esc(t("save"))}</button>` : ""}</div></div>`).join("")}
    </section>
    <section class="card" aria-labelledby="gates-h"><h2 id="gates-h">${esc(t("gates"))}</h2>
      <ul class="clean">${c.gates.map((g) => `<li class="gate"><span class="badge ${g.ok ? "good" : "bad"}"><span aria-hidden="true">${g.ok ? "✓" : "✗"}</span>${esc(g.ok ? t("gate_pass") : t("gate_fail"))}</span> ${esc(t("gate_" + g.gate))}</li>`).join("")}</ul>
      <p>${esc(t("state"))}: <span class="badge ${c.state === "open" ? "warn" : "good"}">${esc(t("state_" + c.state))}</span></p>
      <div class="row">
        ${role === "controller" ? `<button id="ready" ${allOk && c.state === "open" ? "" : "disabled"}>${esc(t("declare_ready"))}</button>` : `<p class="hint">${esc(t("only_controller"))}</p>`}
        ${["controller", "cfo", "fpa"].includes(role) ? `<button class="ghost" id="draft" ${c.state === "open" ? "disabled" : ""}>${esc(t("draft"))}</button>` : ""}
      </div>
    </section></div>
    <div id="summary"></div>
    ${approvals.length ? `<section class="card" aria-labelledby="ap-h"><h2 id="ap-h">${esc(t("approvals"))}</h2>${approvals.map((a) => `<div class="task" style="grid-template-columns:1fr auto auto">
      <div><span class="badge ${a.status === "approved" ? "good" : a.status === "pending" ? "warn" : "bad"}">${esc(t("ap_" + a.status))}</span> <small>${esc(t("hash"))}: ${ltr(a.artifact_hash.slice(0, 12))}…</small></div>
      ${a.status === "pending" && ["cfo", "controller"].includes(role) && a.requested_by !== S.me.user_id ? `<button data-approve="${a.approval_id}" data-hash="${a.artifact_hash}">${esc(t("approve"))}</button>` : "<span></span>"}
      ${a.status === "approved" ? `<button class="ghost" data-csv="${period}">${esc(t("download_csv"))}</button>` : "<span></span>"}</div>`).join("")}</section>` : ""}`;
  el.querySelectorAll("[data-save]").forEach((b) => (b.onclick = () => guarded(b, async () => {
    const id = b.dataset.save;
    await api(`/close/${period}/tasks`, { method: "POST", write: true, body: { task_id: id, status: $(`#s-${id}`).value, evidence_ref: $(`#e-${id}`).value || undefined } });
    toast(t("saved")); await loadClose();
  })));
  $("#ready")?.addEventListener("click", (ev) => guarded(ev.currentTarget, async () => { await api(`/close/${period}/ready`, { method: "POST", write: true }); await loadClose(); }));
  $("#draft")?.addEventListener("click", (ev) => guarded(ev.currentTarget, async () => { const d = await api(`/close/${period}/summary-draft`, { method: "POST", write: true }); showSummary(d, period); }));
  el.querySelectorAll("[data-approve]").forEach((b) => (b.onclick = () => guarded(b, async () => { await api(`/approvals/${b.dataset.approve}/approve`, { method: "POST", write: true, body: { artifact_hash: b.dataset.hash } }); await loadClose(); })));
  el.querySelectorAll("[data-csv]").forEach((b) => (b.onclick = () => guarded(b, async () => {
    await deliverFile(`/export/summary.csv?period=${period}`, `close-summary-${period}.csv`, t("download_csv"));
  })));
}
function showSummary(d, period) {
  const c = d.content;
  $("#summary").innerHTML = `<section class="card" aria-labelledby="sum-h"><h2 id="sum-h">${esc(t("draft"))}: ${esc(monthLabel(period))}</h2>
    <table><thead><tr><th scope="col">${esc(t("col_dept"))}</th><th class="num" scope="col">${esc(t("col_actual"))}</th><th class="num" scope="col">${esc(t("col_plan"))}</th><th class="num" scope="col">${esc(t("col_var"))}</th><th class="num" scope="col">${esc(t("col_pct"))}</th></tr></thead>
    <tbody>${c.rows.map((r) => `<tr><th scope="row">${esc(r.department)}</th><td class="num">${money(r.actual, c.currency)}</td><td class="num">${money(r.plan, c.currency)}</td><td class="num">${money(r.variance, c.currency)}</td><td class="num">${pct(r.variance_pct)}</td></tr>`).join("")}</tbody>
    ${c.total ? `<tfoot><tr><td>${esc(t("total"))}</td><td class="num">${money(c.total.actual, c.currency)}</td><td class="num">${money(c.total.plan, c.currency)}</td><td class="num">${money(c.total.variance, c.currency)}</td><td class="num">${pct(c.total.variance_pct)}</td></tr></tfoot>` : ""}</table>
    <p><small>${esc(t("hash"))}: ${ltr(d.content_hash)}</small></p>
    <button id="reqap">${esc(t("request_approval"))}</button></section>`;
  $("#reqap").onclick = (ev) => guarded(ev.currentTarget, async () => { await api(`/approvals`, { method: "POST", write: true, body: { summary_id: d.summary_id, destination: "export" } }); await loadClose(); });
  $("#sum-h").setAttribute("tabindex", "-1"); $("#sum-h").focus();
}

// ---------------- Explore ----------------
function futureMonths() {
  const last = S.dims.current_snapshot?.periods.at(-1) ?? "2026-03"; const out = []; let [y, m] = last.split("-").map(Number);
  for (let i = 0; i < 9; i++) { m++; if (m > 12) { m = 1; y++; } out.push(`${y}-${String(m).padStart(2, "0")}`); } return out;
}
async function renderExplore(main) {
  const depts = S.dims.departments, months = futureMonths();
  const lever = (i) => `<fieldset class="card" data-lever style="margin:0 0 10px"><legend>${esc(t("lever"))} ${i + 1}</legend><div class="row">
    <div><label>${esc(t("lever_dept"))}<select name="department">${depts.map((d) => `<option value="${esc(d.code)}">${esc(S.lang === "he-IL" ? d.label_he : d.label_en)}</option>`).join("")}</select></label></div>
    <div><label>${esc(t("lever_kind"))}<select name="kind"><option value="pct">${esc(t("kind_pct"))}</option><option value="amount">${esc(t("kind_amount"))}</option></select></label></div>
    <div><label>${esc(t("lever_from"))}<select name="from_period">${months.map((p) => `<option value="${p}">${esc(monthLabel(p))}</option>`).join("")}</select></label></div>
    <div><label>${esc(t("lever_value"))}<span class="hint" data-hint>${esc(t("lever_value_hint_pct"))}</span><input name="value" inputmode="decimal" required pattern="-?[0-9]+(\\.[0-9]{1,2})?" value="5" dir="ltr"></label></div>
    <div style="flex:0 0 auto"><button type="button" class="ghost" data-rm>${esc(t("remove"))}</button></div></div></fieldset>`;
  main.innerHTML = `<h1>${esc(t("explore_title"))}</h1><p class="sub">${esc(t("explore_sub"))}</p>
    <form id="scf" class="card"><div class="field"><label for="scn">${esc(t("scenario_name"))}</label><input id="scn" required value="${S.lang === "he-IL" ? "תרחיש לדוגמה" : "Sample scenario"}"></div>
      <div id="levers">${lever(0)}</div>
      <div class="row"><button type="button" class="ghost" id="addl" style="flex:0 0 auto">${esc(t("add_lever"))}</button><button id="calc" style="flex:0 0 auto">${esc(t("calc"))}</button></div></form>
    <section id="scres" aria-live="polite"></section>`;
  const wire = () => main.querySelectorAll("[data-lever]").forEach((fs, i) => {
    fs.querySelector("legend").textContent = `${t("lever")} ${i + 1}`;
    fs.querySelector("[data-rm]").onclick = () => { if (main.querySelectorAll("[data-lever]").length > 1) { fs.remove(); wire(); } };
    fs.querySelector("[name=kind]").onchange = (e) => { fs.querySelector("[data-hint]").textContent = t(e.target.value === "pct" ? "lever_value_hint_pct" : "lever_value_hint_amount"); };
  });
  wire();
  $("#addl").onclick = () => { $("#levers").insertAdjacentHTML("beforeend", lever(main.querySelectorAll("[data-lever]").length)); wire(); };
  $("#scf").onsubmit = (ev) => { ev.preventDefault(); guarded($("#calc"), async () => {
    const levers = [...main.querySelectorAll("[data-lever]")].map((fs) => Object.fromEntries(["department", "kind", "from_period", "value"].map((n) => [n, fs.querySelector(`[name=${n}]`).value])));
    const s = await api("/scenarios", { method: "POST", write: true, body: { name: $("#scn").value, levers } });
    renderScenario(await api(`/scenarios/${s.scenario_id}/calculate`, { method: "POST" }));
  }); };
}
function renderScenario(r) {
  const ccy = S.dims.plan_versions[0]?.base_currency ?? "USD";
  const W = 640, H = 240, pad = 36, n = r.months.length, max = Math.max(...r.months.map((m) => Math.max(Number(m.baseline), Number(m.scenario))), 1);
  const bw = (W - pad * 2) / n / 2.6;
  const bars = r.months.map((m, i) => { const x = pad + i * ((W - pad * 2) / n); const h1 = (Number(m.baseline) / max) * (H - pad * 2), h2 = (Number(m.scenario) / max) * (H - pad * 2);
    return `<rect x="${x}" y="${H - pad - h1}" width="${bw}" height="${h1}" fill="var(--line)"/><rect x="${x + bw + 3}" y="${H - pad - h2}" width="${bw}" height="${h2}" fill="var(--brand)"/><text x="${x + bw}" y="${H - pad + 16}" font-size="11" text-anchor="middle" fill="var(--muted)">${m.period.slice(5)}/${m.period.slice(2, 4)}</text>`; }).join("");
  $("#scres").innerHTML = `<div class="card"><div class="notice" role="note"><strong>${esc(t("hypothetical"))}</strong></div>
    <div class="grid">${["baseline", "scenario", "delta"].map((k) => `<div class="card" style="margin:0"><div class="hint">${esc(t(k))}</div><div class="lead" style="margin:0">${money(r.totals[k], ccy)}</div></div>`).join("")}</div>
    <figure class="chart" style="margin:16px 0"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t("chart_label"))}" dir="ltr">${bars}</svg>
      <figcaption class="hint"><span style="color:var(--muted)">■</span> ${esc(t("baseline"))} · <span style="color:var(--brand)">■</span> ${esc(t("scenario"))}</figcaption></figure>
    <table><caption>${esc(r.name)}</caption><thead><tr><th scope="col">${esc(t("month"))}</th><th class="num" scope="col">${esc(t("baseline"))}</th><th class="num" scope="col">${esc(t("scenario"))}</th><th class="num" scope="col">${esc(t("delta"))}</th></tr></thead>
    <tbody>${r.months.map((m) => `<tr><th scope="row">${esc(monthLabel(m.period))}</th><td class="num">${money(m.baseline, ccy)}</td><td class="num">${money(m.scenario, ccy)}</td><td class="num">${money(m.delta, ccy)}</td></tr>`).join("")}</tbody></table>
    <details><summary>${esc(t("assumptions"))}</summary><ul>${r.assumptions.map((a) => `<li>${esc(a)}</li>`).join("")}</ul></details></div>`;
}

// ---------------- Data ----------------
async function renderData(main) {
  main.innerHTML = `<h1>${esc(t("data_title"))}</h1><p class="sub">${esc(t("data_sub"))}</p>
  <div class="card"><h2>${esc(t("templates"))}</h2><div class="row"><button type="button" class="ghost" data-tpl="actuals">${esc(t("tpl_actuals"))}</button><button type="button" class="ghost" data-tpl="plan">${esc(t("tpl_plan"))}</button></div></div>
  <form id="impf" class="card">
    <div class="row"><div><label for="kind">${esc(t("kind"))}</label><select id="kind"><option value="actual">${esc(t("kind_actual"))}</option><option value="plan">${esc(t("kind_plan"))}</option></select></div>
      <div id="pn" hidden><label for="plan_name">${esc(t("plan_name"))}</label><input id="plan_name" value="Budget"></div></div>
    <div class="field"><label for="file">${esc(t("file"))}</label><div class="drop" id="drop"><p>${esc(t("drop"))}</p><input id="file" type="file" accept=".csv,.xlsx" required></div></div>
    <div class="field"><label for="ct">${esc(t("control_total"))} <span class="hint" id="ct-h">${esc(t("control_hint"))}</span></label><input id="ct" inputmode="decimal" required dir="ltr" aria-describedby="ct-h" placeholder="107100.00"></div>
    <div id="mapping"></div>
    <button id="chk">${esc(t("check_file"))}</button>
  </form><section id="impres" aria-live="polite"></section>`;
  main.querySelectorAll("[data-tpl]").forEach((b) => (b.onclick = () => guarded(b, () => deliverFile(`/api/v1/templates/${b.dataset.tpl}.csv`, `${b.dataset.tpl}-template.csv`, b.textContent))));
  $("#kind").onchange = () => ($("#pn").hidden = $("#kind").value !== "plan");
  const drop = $("#drop");
  ["dragover", "dragenter"].forEach((e) => drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((e) => drop.addEventListener(e, () => drop.classList.remove("over")));
  drop.addEventListener("drop", (ev) => { ev.preventDefault(); $("#file").files = ev.dataTransfer.files; });
  $("#impf").onsubmit = (ev) => { ev.preventDefault(); guarded($("#chk"), async () => {
    const f = $("#file").files[0]; const xlsx = f.name.toLowerCase().endsWith(".xlsx");
    const content = xlsx ? btoa(String.fromCharCode(...new Uint8Array(await f.arrayBuffer()))) : await f.text();
    const mapping = Object.fromEntries([...document.querySelectorAll("[data-map]")].map((s) => [s.dataset.map, s.value]));
    const r = await api("/imports", { method: "POST", write: true, body: { kind: $("#kind").value, filename: f.name, content, encoding: xlsx ? "base64" : "text", control_total: $("#ct").value, plan_name: $("#plan_name").value, ...(Object.keys(mapping).length ? { mapping } : {}) } });
    showImport(r);
  }); };
}
function showImport(r) {
  const el = $("#impres");
  if (r.status === "needs_mapping") {
    $("#mapping").innerHTML = `<div class="notice info">${esc(t("needs_mapping"))}</div><div class="row">${r.missing.concat(Object.keys(r.suggested)).filter((v, i, a) => a.indexOf(v) === i).map((f) => `<div><label>${esc(t("f_" + f))}<select data-map="${f}">${r.headers.map((h) => `<option ${r.suggested[f] === h ? "selected" : ""}>${esc(h)}</option>`).join("")}</select></label></div>`).join("")}</div>`;
    el.innerHTML = ""; $("#mapping").querySelector("select")?.focus(); return;
  }
  if (r.status === "passed" || r.status === "published") {
    el.innerHTML = `<div class="card"><div class="notice ok">${esc(t("import_passed", { rows: r.row_count ?? "", total: r.rows_total ?? "" }))}</div>
      ${r.status === "passed" ? `<button id="pub">${esc(t("publish"))}</button>` : `<p>${esc(t("published"))}</p>`}</div>`;
    $("#pub")?.addEventListener("click", (ev) => guarded(ev.currentTarget, async () => {
      await api(`/imports/${r.import_id}/publish`, { method: "POST", write: true });
      el.innerHTML = `<div class="card"><div class="notice ok">${esc(t("published"))}</div></div>`; S.dims = await api("/dimensions"); renderContext();
    }));
  } else {
    el.innerHTML = `<div class="card"><div class="notice">${esc(t("import_failed", { n: r.errors.length }))}</div>
      <div style="overflow-x:auto"><table class="resp"><thead><tr><th scope="col">${esc(t("err_code"))}</th><th scope="col">${esc(t("err_row"))}</th><th scope="col">${esc(t("err_fix"))}</th><th scope="col">${esc(t("err_msg"))}</th></tr></thead>
      <tbody>${r.errors.map((e) => `<tr><td><strong>${esc(t("E_" + e.code))}</strong></td><td data-label="${esc(t("err_row"))}">${ltr(e.source_row_id ?? "")}</td><td>${esc(t("FIX_" + e.code))}</td><td data-label="${esc(t("err_msg"))}"><small>${ltr(e.message.replace(/invalid:/, ""))}</small></td></tr>`).join("")}</tbody></table></div></div>`;
  }
  el.querySelector(".notice")?.setAttribute("tabindex", "-1"); el.querySelector(".notice")?.focus();
}

// ---------------- Audit ----------------
async function renderAudit(main) {
  const rows = await api("/audit");
  main.innerHTML = `<h1>${esc(t("audit_title"))}</h1><p class="sub">${esc(t("audit_sub"))}</p><div class="card" style="overflow-x:auto"><table>
    <thead><tr><th scope="col">${esc(t("a_when"))}</th><th scope="col">${esc(t("a_action"))}</th><th scope="col">${esc(t("a_decision"))}</th><th scope="col">${esc(t("a_result"))}</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><td>${esc(new Date(r.at).toLocaleString(S.lang))}</td><td>${ltr(r.action)}</td><td><span class="badge ${r.policy_decision === "allow" ? "good" : "bad"}">${esc(t(r.policy_decision))}</span></td><td>${ltr(r.result)}</td></tr>`).join("")}</tbody></table></div>`;
}

boot();
