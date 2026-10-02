// הממשק: לובי, שולחן, קופסת הכרזות, קלפים, פתק תוצאות ודירוג.
import { suitOf, rankOf, rankLabel, SUIT_SYMBOL, SEAT_NAME_HE, sortForDisplay, handHcp, sideOf, NT } from '../engine/cards.js';
import { PASS, DOUBLE, REDOUBLE, bid, isBid, levelOf, strainOf, callText, contractText, STRAIN_SYMBOL } from '../engine/bidding.js';
import { BoardGame } from '../game/board.js';
import { createTournament, boardNoAt, opponentsAt, standings, matchpoints, PARTNER, WORLD_PAIRS, LEVELS, levelConfig } from '../game/tournament.js';
import { chooseCall } from '../ai/bid-ai.js';
import { ask } from '../ai/client.js';

const HUMAN = 2; // דרום
const STORE_KEY = 'talbot.bridge.v1';

/** @typedef {{name:string, scale:number, speed:'slow'|'normal'|'fast', colors:2|4, confirm:boolean, sound:boolean, showHcp:boolean, contrast:'normal'|'high'}} Settings */
/** @type {Settings} */
const DEFAULTS = { name: 'סבתא', scale: 1.15, speed: 'slow', colors: 2, confirm: true, sound: true, showHcp: false, contrast: 'normal' };

/** @type {{settings:Settings, tournament:any, lastBoards:number, lastLevel:string}} */
let store = { settings: { ...DEFAULTS }, tournament: null, lastBoards: 8, lastLevel: 'champion' };
try {
  const raw = localStorage.getItem(STORE_KEY);
  if (raw) { const s = JSON.parse(raw); store = { ...store, ...s, settings: { ...DEFAULTS, ...(s.settings || {}) } }; }
} catch { /* בלי שמירה */ }
function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch { /* מצב פרטי */ } }

// ---------- מצב ריצה ----------
let view = 'lobby';
/** @type {BoardGame|null} */ let game = null;
let busy = false;           // בוט חושב
/** @type {number|null} */ let selected = null; // הכרזה/קלף שנבחרו ומחכים לאישור
let showAllLevels = false;
/** @type {any} */ let pausedTrick = null; // לקיחה שהושלמה ומוצגת רגע
let fieldPromise = null;
let hintCard = null;
let loopToken = 0;

const app = /** @type {HTMLElement} */ (document.getElementById('app'));
const wideLayout = window.matchMedia('(min-width: 1000px)');
wideLayout.addEventListener('change', () => { if (view === 'table') render(); });
/** מספר עם סימן, תמיד משמאל לימין: -450, +1 */
const num = (n, plus = true) => `<span dir="ltr">${n > 0 && plus ? '+' : ''}${n}</span>`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SPEEDS = { slow: { bid: 1100, card: 1200, trick: 2200 }, normal: { bid: 700, card: 750, trick: 1500 }, fast: { bid: 300, card: 350, trick: 900 } };
const pace = () => SPEEDS[store.settings.speed] || SPEEDS.slow;

function applySettings() {
  const r = document.documentElement;
  r.style.setProperty('--scale', String(store.settings.scale));
  r.dataset.colors = String(store.settings.colors);
  r.dataset.contrast = store.settings.contrast;
}

// ---------- צליל עדין ----------
let audio = null;
function tick(freq = 520, dur = 0.06) {
  if (!store.settings.sound) return;
  try {
    audio = audio || new (window.AudioContext || /** @type {any} */ (window).webkitAudioContext)();
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = 'triangle'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.08, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + dur);
    o.connect(g).connect(audio.destination); o.start(); o.stop(audio.currentTime + dur);
  } catch { /* בלי צליל */ }
}

// ---------- מסך לא נכבה ----------
let wakeLock = null;
async function keepAwake() {
  try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await /** @type {any} */ (navigator).wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch { /* לא נתמך */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && view === 'table') keepAwake(); });

// ---------- עזרי תצוגה ----------
const suitClass = (s) => (s === 2 ? 'red' : s === 1 ? 'dia' : s === 0 ? 'clb' : '');
function cardHtml(c, cls = '', attrs = '') {
  const s = suitOf(c);
  return `<button class="card ${suitClass(s)} ${cls}" data-card="${c}" ${attrs} aria-label="${rankLabel(rankOf(c))} ${SUIT_SYMBOL[s]}">
    <span class="r">${rankLabel(rankOf(c))}</span><span class="s">${SUIT_SYMBOL[s]}</span></button>`;
}
function callHtml(c) {
  if (!isBid(c)) return callText(c);
  const st = strainOf(c);
  return `${levelOf(c)}<span class="${st < 4 ? suitClass(st) : ''}" style="${st === 2 ? 'color:var(--red)' : st === 1 ? 'color:var(--diamond)' : st === 0 ? 'color:var(--club)' : ''}">${STRAIN_SYMBOL[st]}</span>`;
}
const contractHtml = (ct) => (ct ? `${ct.level}${coloredStrain(ct.strain)}${ct.doubled === 2 ? ' XX' : ct.doubled ? ' X' : ''}` : 'כולם פס');
function coloredStrain(st) {
  if (st === 4) return 'NT';
  const color = st === 2 ? 'var(--red)' : st === 1 ? 'var(--diamond)' : st === 0 ? 'var(--club)' : 'inherit';
  return `<span style="color:${color};${st === 3 || st === 0 ? 'text-shadow:0 0 2px #fff' : ''}">${SUIT_SYMBOL[st]}</span>`;
}

function seatNames() {
  const t = store.tournament;
  const opp = opponentsAt(t, t.index);
  const [w, e] = splitPair(opp.names);
  return [
    { name: PARTNER.name, flag: PARTNER.flag },
    { name: e, flag: opp.flag },
    { name: store.settings.name || 'את', flag: '🇮🇱', me: true },
    { name: w, flag: opp.flag },
  ];
}
function splitPair(names) {
  const i = names.indexOf(' ו');
  return i > 0 ? [names.slice(0, i), names.slice(i + 2)] : [names, names];
}

function toast(msg, ms = 2600) {
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = msg; el.setAttribute('role', 'status');
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

// ---------- חלונות ----------
function openSheet(html, onClick) {
  closeSheet();
  const bg = document.createElement('div');
  bg.className = 'sheet-bg';
  bg.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  bg.addEventListener('click', (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    if (target === bg && !bg.dataset.sticky) { closeSheet(); return; }
    const b = /** @type {HTMLElement|null} */ (target.closest('[data-act]'));
    if (b) onClick(b.dataset.act, b);
  });
  document.body.appendChild(bg);
  return bg;
}
function closeSheet() { document.querySelectorAll('.sheet-bg').forEach((x) => x.remove()); }

// =====================================================================
// לובי
// =====================================================================
function renderLobby() {
  const t = store.tournament;
  const day = Math.floor(Date.now() / 86400000);
  const online = 1800 + ((day * 7919) % 900) + new Date().getHours() * 23;
  const countries = 40 + (day % 12);
  const sel = store.lastBoards || 8;
  const inProgress = t && t.index < t.boards;
  const rOff = levelConfig(store.lastLevel || 'champion').rating;
  const shown = [...WORLD_PAIRS].sort((a, b) => b.rating - a.rating).slice(0, 8).map((p) => ({ ...p, rating: p.rating + rOff }));
  app.innerHTML = `
  <main class="lobby">
    <div class="brand">
      <div class="suits">♠<span class="r">♥</span>♣<span class="r">♦</span></div>
      <h1>טורניר הברידג' העולמי</h1>
      <div class="sub">שלום ${esc(store.settings.name)}! טוב לראות אותך שוב</div>
    </div>
    <div class="row center"><span class="live"><span class="dot"></span>${online.toLocaleString('he-IL')} שחקנים מחוברים מ-${countries} מדינות</span></div>
    ${inProgress ? `
    <section class="card-panel">
      <h2>הטורניר שלך מחכה</h2>
      <p class="muted" style="margin:0 0 10px">חלוקה ${t.index + 1} מתוך ${t.boards}</p>
      <button class="btn primary big" data-act="continue">▶ המשיכי לשחק</button>
    </section>` : ''}
    <section class="card-panel">
      <h2>${inProgress ? 'או טורניר חדש' : 'טורניר חדש'}</h2>
      <div class="choice" role="group" aria-label="אורך הטורניר">
        ${[[6, 'קצר', '~30 דקות'], [8, 'רגיל', '~45 דקות'], [12, 'ארוך', '~70 דקות']].map(([n, l, d]) =>
          `<button class="btn" data-act="len" data-n="${n}" aria-pressed="${sel === n}"><b>${l}</b><span>${n} חלוקות</span><small>${d}</small></button>`).join('')}
      </div>
      <h2 style="margin-top:14px">רמת היריבים</h2>
      <div class="choice" role="group" aria-label="רמת היריבים">
        ${Object.entries(LEVELS).map(([k, L]) =>
          `<button class="btn" data-act="lvl" data-l="${k}" aria-pressed="${(store.lastLevel || 'champion') === k}"><b>${L.name}</b><small>${L.desc}</small></button>`).join('')}
      </div>
      <div style="height:12px"></div>
      <button class="btn ${inProgress ? '' : 'primary'} big" data-act="new">🏆 הצטרפי לטורניר</button>
    </section>
    <section class="card-panel">
      <h2>הזוגות המובילים היום</h2>
      <ul class="players">${shown.map((p) => `<li><span class="flag">${p.flag}</span><span>${esc(p.names)}</span><span class="rating">${p.rating}</span></li>`).join('')}</ul>
    </section>
    <div class="row center">
      <button class="btn ghost" data-act="settings">⚙ הגדרות</button>
      <button class="btn ghost" data-act="help">? עזרה</button>
    </div>
  </main>`;
  app.onclick = (e) => {
    const b = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-act]'));
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'len') { store.lastBoards = Number(b.dataset.n); save(); renderLobby(); }
    else if (act === 'lvl') { store.lastLevel = b.dataset.l; save(); renderLobby(); }
    else if (act === 'new') {
      if (inProgress) {
        openSheet(`<h2>להתחיל טורניר חדש?</h2><p>הטורניר הנוכחי יימחק.</p>
          <div class="row"><button class="btn primary" data-act="yes">כן, טורניר חדש</button><button class="btn ghost" data-act="no">לא</button></div>`,
        (a) => { closeSheet(); if (a === 'yes') newTournament(); });
      } else newTournament();
    } else if (act === 'continue') startBoard();
    else if (act === 'settings') openSettings();
    else if (act === 'help') openHelp();
  };
}

function newTournament() {
  store.tournament = createTournament({ boards: store.lastBoards || 8, playerName: store.settings.name, level: store.lastLevel || 'champion' });
  save();
  showRoundIntro(true);
}

function showRoundIntro(first = false) {
  const t = store.tournament;
  const opp = opponentsAt(t, t.index);
  const round = Math.floor(t.index / 2) + 1, rounds = Math.ceil(t.boards / 2);
  openSheet(`
    <h2>${first ? '🏆 ברוכה הבאה לטורניר!' : '🔄 החלפת שולחן'}</h2>
    <p style="font-size:1.1em">סבב ${round} מתוך ${rounds}. היריבים שלך:</p>
    <p class="big-result">${opp.flag} ${esc(opp.names)}</p>
    <p class="muted" style="color:#555;text-align:center">${esc(opp.country)} · דירוג ${opp.rating + levelConfig(t.level).rating} · רמת ${levelConfig(t.level).name}</p>
    <p>השותפה שלך: ${PARTNER.flag} <b>${PARTNER.name}</b></p>
    <button class="btn primary big" data-act="go">לשולחן ▶</button>`, () => { closeSheet(); startBoard(); }).dataset.sticky = '1';
}

// =====================================================================
// השולחן
// =====================================================================
function startBoard() {
  closeSheet();
  const t = store.tournament;
  const boardNo = boardNoAt(t, t.index);
  game = new BoardGame({ boardNo, seed: t.seed, humanSeat: HUMAN, calls: t.live?.calls || [], plays: t.live?.plays || [] });
  if (t.live?.claim != null) game.claim(t.live.claim);
  fieldPromise = ask('field', { seed: t.seed, boardNo, tables: t.field.length, level: t.level });
  view = 'table'; selected = null; showAllLevels = false; pausedTrick = null; hintCard = null;
  keepAwake();
  render();
  runLoop();
}
function saveLive() {
  const s = game.snapshot();
  store.tournament.live = { calls: s.calls, plays: s.plays, claim: game.claimed };
  save();
}

async function runLoop() {
  const token = ++loopToken;
  while (game && view === 'table' && token === loopToken) {
    if (game.phase === 'done') { await finishBoard(); return; }
    const a = game.actor();
    if (a.human) { busy = false; render(); return; }
    busy = true; render();
    const p = pace();
    if (game.phase === 'bidding') {
      await sleep(p.bid);
      if (token !== loopToken) return;
      const c = chooseCall(game.hands[a.seat], game.auction.calls, game.auction.dealer, game.info.vul);
      doCallInternal(c);
    } else {
      const t0 = Date.now();
      const v = game.playView();
      const card = v.legal.length === 1 ? v.legal[0]
        : await ask('card', { view: v, opts: { seed: game.boardNo * 1000 + game.plays.length, maxSamples: levelConfig(store.tournament.level).samples, timeMs: levelConfig(store.tournament.level).timeMs,
          blunder: a.seat % 2 === 1 ? levelConfig(store.tournament.level).blunder : 0 } });
      const wait = p.card - (Date.now() - t0);
      if (wait > 0) await sleep(wait);
      if (token !== loopToken) return;
      await doCardInternal(card);
    }
  }
}

function doCallInternal(c) {
  game.addCall(c);
  tick(440);
  saveLive();
}
async function doCardInternal(card) {
  const r = game.addCard(card);
  tick(r.trickDone ? 660 : 520);
  hintCard = null;
  saveLive();
  if (r.trickDone) {
    pausedTrick = game.play.history[game.play.history.length - 1];
    render();
    await sleep(pace().trick);
    pausedTrick = null;
  }
  render();
}

function humanCall(c) {
  if (busy || !game || game.phase !== 'bidding' || !game.actor().human) return;
  if (!game.auction.isLegal(c)) return;
  if (store.settings.confirm && selected !== c) { selected = c; render(); return; }
  selected = null; showAllLevels = false;
  doCallInternal(c);
  runLoop();
}
async function humanCard(c) {
  if (busy || !game || game.phase !== 'playing') return;
  const a = game.actor();
  if (!a.human || !game.play.isLegal(c)) return;
  if (store.settings.confirm && selected !== c) { selected = c; render(); tick(800, 0.03); return; }
  selected = null; busy = true;
  await doCardInternal(c);
  busy = false;
  runLoop();
}

function render() {
  try {
    if (view === 'lobby') return renderLobby();
    if (view === 'final') return renderFinal();
    renderTable();
  } catch (e) {
    // תקלת תצוגה לא תעצור את המשחק
    console.error(e);
  }
}

function renderTable() {
  const t = store.tournament, g = game;
  const names = seatNames();
  const ct = g.contract, play = g.play;
  const a = g.actor();
  const vul = g.info.vul;
  const ourVul = vul[0], theirVul = vul[1];
  const st = t.results.length ? standings(t) : null;
  const place = st ? st.findIndex((r) => r.me) + 1 : null;
  const dummySeat = play ? play.dummy : null;
  const dummyShown = play && play.dummyVisible();
  const myTurn = a && a.human && !busy && !pausedTrick;

  const seatTag = (s) => {
    const n = names[s];
    const role = play ? (s === play.declarer ? 'מכריז' : s === play.dummy ? 'דומם' : '') : (s === g.info.dealer && g.auction.calls.length === 0 ? 'מחלק' : '');
    const turn = a && (a.seat === s) && !pausedTrick;
    return `<div class="seat ${vul[sideOf(s)] ? 'vul' : ''} ${turn ? 'turn' : ''}"><span class="flag">${n.flag}</span><span class="nm">${esc(n.name)}</span>${role ? `<span class="role">${role}</span>` : ''}</div>`;
  };
  const backs = (s) => `<div class="backs" aria-label="${g.play ? g.play.hands[s].length : 13} קלפים">${'<i></i>'.repeat(Math.min(13, play ? play.hands[s].length : 13))}</div>`;

  // הדומם
  const dummyHtml = (s) => {
    const hand = play.hands[s];
    const controller = play.declarer;
    const interactive = myTurn && controller === HUMAN && a.seat === s;
    const legal = interactive ? play.legalCards(s) : [];
    const order = play.trump !== null ? [play.trump, ...[3, 2, 0, 1].filter((x) => x !== play.trump)] : [3, 2, 0, 1];
    return `<div class="dummy-wrap"><div class="dummy-label">הדומם של ${esc(names[s].name)}${interactive ? ' · תורך לשחק מהדומם' : ''}</div><div class="dummy">${order.map((su) => {
      const cards = hand.filter((c) => suitOf(c) === su).sort((x, y) => rankOf(y) - rankOf(x));
      return `<div class="col"><div class="suit-h" style="color:${su === 2 ? 'var(--red)' : su === 1 ? 'var(--diamond)' : su === 0 ? 'var(--club)' : '#111'};${su === 3 || su === 0 ? 'text-shadow:0 0 3px #fff' : ''}">${SUIT_SYMBOL[su]}</div>
        <div class="chips">${cards.map((c) => {
          const off = interactive && !legal.includes(c);
          return `<button class="chip ${suitClass(su)} ${off ? 'off' : ''} ${interactive && !off ? 'playable' : ''} ${selected === c ? 'sel' : ''}" data-card="${c}" ${interactive && !off ? '' : 'tabindex="-1"'}>${rankLabel(rankOf(c))}</button>`;
        }).join('') || '<span class="muted">—</span>'}</div></div>`;
    }).join('')}</div></div>`;
  };

  // היד שלי
  const myHand = () => {
    const hand = play ? play.hands[HUMAN] : g.hands[HUMAN];
    const sorted = sortForDisplay(hand, play ? play.trump : null);
    const interactive = myTurn && play && a.seat === HUMAN;
    const legal = interactive ? play.legalCards(HUMAN) : [];
    const iAmDummy = g.humanIsDummy();
    return `${iAmDummy && dummyShown ? `<div class="dummy-label">את הדומם · ${esc(PARTNER.name)} משחקת את החוזה</div>` : ''}
      <div class="hand">${sorted.map((c) => cardHtml(c, `${interactive ? (legal.includes(c) ? 'playable' : 'off') : ''} ${selected === c ? 'sel' : ''} ${hintCard === c ? 'sel' : ''}`)).join('')}</div>`;
  };

  // מרכז
  let center = '';
  if (g.phase === 'bidding') {
    center = auctionTable(names);
  } else if (play) {
    const tr = pausedTrick ? pausedTrick.plays : play.trick;
    const winner = pausedTrick ? pausedTrick.winner : null;
    center = `<div class="trick">${tr.map((p) => cardHtml(p.card, `pos-${p.seat} ${winner === p.seat ? 'win' : ''}`, 'tabindex="-1"')).join('')}
      ${!tr.length ? `<div class="ct"><div class="contract-badge">חוזה ${contractHtml(ct)}<br><small>${esc(names[ct.declarer].name)} מכריז/ה</small></div></div>` : ''}</div>`;
  }

  const north = dummyShown && dummySeat === 0 ? dummyHtml(0) : backs(0);
  const ewDummy = dummyShown && (dummySeat === 1 || dummySeat === 3) ? dummyHtml(dummySeat) : '';
  const side = wideLayout.matches; // במסך רחב הדומם יושב בצד שלו

  // מעגן
  let dock = '';
  const usTricks = play ? play.won[0] : 0, themTricks = play ? play.won[1] : 0;
  if (g.phase === 'bidding') {
    if (myTurn) dock = `<div class="banner your">תורך להכריז</div>${bidBox()}`;
    else dock = `<div class="banner"><span class="thinking">${esc(names[a.seat].name)} חושב/ת</span></div>`;
    dock += `<div class="tools">${myTurn ? '<button class="btn" data-act="hint">💡 עצה</button>' : ''}${store.settings.showHcp ? `<span class="pill">${handHcp(g.hands[HUMAN])} נקודות</span>` : ''}</div>`;
  } else if (play) {
    const weDeclare = sideOf(play.declarer) === 0;
    const needed = ct.level + 6;
    dock = `<div class="tricks-count"><span>אנחנו: ${usTricks}</span><span>הם: ${themTricks}</span>
      <span class="muted">${weDeclare ? `צריך ${needed} לקיחות` : `להפלה צריך ${14 - needed}`}</span></div>`;
    if (myTurn) {
      const fromDummy = a.seat !== HUMAN;
      dock += `<div class="banner your">${fromDummy ? 'תורך לשחק קלף מהדומם' : 'תורך לשחק קלף'}${store.settings.confirm ? '<br><small class="muted">לחיצה בוחרת, לחיצה שנייה משחקת</small>' : ''}</div>`;
      if (selected !== null) dock += `<div class="confirm"><button class="btn primary" data-act="play-sel">שחקי ${rankLabel(rankOf(selected))}${SUIT_SYMBOL[suitOf(selected)]}</button><button class="btn" data-act="unsel">ביטול</button></div>`;
    } else if (!a) {
      dock += `<div class="banner"><span class="thinking">סופרים את התוצאות</span></div>`;
    } else if (!pausedTrick) {
      dock += `<div class="banner"><span class="thinking">${esc(names[a.seat === play.dummy ? play.declarer : a.seat].name)} חושב/ת</span></div>`;
    } else dock += `<div class="banner">${esc(names[pausedTrick.winner].name)} לקח/ה את הלקיחה</div>`;
    dock += `<div class="tools">${play.history.length ? '<button class="btn" data-act="last">↺ הלקיחה הקודמת</button>' : ''}
      ${myTurn ? '<button class="btn" data-act="hint">💡 עצה</button>' : ''}
      ${myTurn && play.declarer === HUMAN && play.trick.length === 0 && play.history.length < 12 ? '<button class="btn" data-act="claim">✋ כל השאר שלי</button>' : ''}</div>`;
  }

  app.innerHTML = `
  <div class="screen-table">
    <header class="topbar">
      <div class="info">
        <span class="pill gold">חלוקה ${t.index + 1}/${t.boards}</span>
        <span class="pill ${ourVul ? 'vul' : 'nonvul'}" title="פגיעות">אנחנו: ${ourVul ? 'פגיעים' : 'לא פגיעים'}</span>
        <span class="pill ${theirVul ? 'vul' : 'nonvul'}">הם: ${theirVul ? 'פגיעים' : 'לא פגיעים'}</span>
        ${ct && g.phase !== 'bidding' ? `<span class="pill">חוזה ${contractHtml(ct)}</span>` : ''}
        ${place ? `<span class="pill">🏅 מקום ${place}/${t.field.length + 1}</span>` : ''}
      </div>
      <button class="icon-btn" data-act="menu" aria-label="תפריט">☰</button>
    </header>
    <section class="felt">
      <div class="area-n">${seatTag(0)}${north}</div>
      <div class="area-d">${side ? '' : ewDummy}</div>
      <div class="area-w">${seatTag(3)}${side && dummySeat === 3 ? ewDummy : ''}</div>
      <div class="area-c">${center}</div>
      <div class="area-e">${seatTag(1)}${side && dummySeat === 1 ? ewDummy : ''}</div>
      <div class="area-s">${myHand()}${seatTag(2)}</div>
    </section>
    <footer class="dock">${dock}</footer>
  </div>`;

  app.onclick = (e) => {
    const el = /** @type {HTMLElement} */ (e.target);
    const cardEl = /** @type {HTMLElement|null} */ (el.closest('[data-card]'));
    if (cardEl && cardEl.closest('.area-s, .area-n, .area-d')) { humanCard(Number(cardEl.dataset.card)); return; }
    const callEl = /** @type {HTMLElement|null} */ (el.closest('[data-call]'));
    if (callEl) { humanCall(Number(callEl.dataset.call)); return; }
    const b = /** @type {HTMLElement|null} */ (el.closest('[data-act]'));
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'confirm-call' && selected !== null) humanCall(selected);
    else if (act === 'unsel') { selected = null; render(); }
    else if (act === 'play-sel' && selected !== null) humanCard(selected);
    else if (act === 'more') { showAllLevels = true; render(); }
    else if (act === 'menu') openMenu();
    else if (act === 'last') showLastTrick();
    else if (act === 'hint') giveHint();
    else if (act === 'claim') tryClaim();
  };
}

function auctionTable(names) {
  const g = game;
  const cols = [3, 0, 1, 2]; // מערב צפון מזרח דרום
  const cells = [];
  const offset = cols.indexOf(g.info.dealer);
  for (let i = 0; i < offset; i++) cells.push('<td></td>');
  g.auction.calls.forEach((c) => {
    const cls = c === PASS ? 'p' : c === DOUBLE ? 'x' : c === REDOUBLE ? 'xx' : '';
    cells.push(`<td class="${cls}">${c === DOUBLE ? 'X' : c === REDOUBLE ? 'XX' : c === PASS ? 'פס' : callHtml(c)}</td>`);
  });
  if (!g.auction.isComplete()) cells.push('<td class="q">?</td>');
  const rows = [];
  for (let i = 0; i < cells.length; i += 4) rows.push(`<tr>${cells.slice(i, i + 4).join('')}${'<td></td>'.repeat(Math.max(0, 4 - cells.slice(i, i + 4).length))}</tr>`);
  return `<div class="auction"><table><thead><tr>${cols.map((s) => `<th class="${g.info.vul[sideOf(s)] ? 'vul' : ''}">${esc(names[s].name)}${s === g.info.dealer ? ' (מחלק)' : ''}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

function bidBox() {
  const A = game.auction;
  const legal = new Set(A.legalCalls());
  const minBid = [...legal].filter(isBid).sort((x, y) => x - y)[0];
  const minLevel = minBid ? levelOf(minBid) : 8;
  const maxShown = showAllLevels ? 7 : Math.min(7, minLevel + 2);
  let grid = '';
  for (let L = minLevel; L <= maxShown; L++) {
    for (let s = 0; s < 5; s++) {
      const c = bid(L, s);
      grid += `<button class="b ${selected === c ? 'sel' : ''}" data-call="${c}" ${legal.has(c) ? '' : 'disabled'} aria-label="${L} ${STRAIN_SYMBOL[s]}">${callHtml(c)}</button>`;
    }
  }
  if (maxShown < 7) grid += `<button class="more-levels" data-act="more">גבהים נוספים (עד 7) ▾</button>`;
  const calls = `<div class="calls">
    <button class="b pass ${selected === PASS ? 'sel' : ''}" data-call="${PASS}">פס</button>
    <button class="b dbl ${selected === DOUBLE ? 'sel' : ''}" data-call="${DOUBLE}" ${legal.has(DOUBLE) ? '' : 'disabled'}>כפל X</button>
    <button class="b rdbl ${selected === REDOUBLE ? 'sel' : ''}" data-call="${REDOUBLE}" ${legal.has(REDOUBLE) ? '' : 'disabled'}>XX</button></div>`;
  const confirm = selected !== null ? `<div class="confirm"><button class="btn primary" data-act="confirm-call">הכריזי ${callHtml(selected)}</button><button class="btn" data-act="unsel">ביטול</button></div>` : '';
  return `${confirm}<div class="bidbox">${grid}</div>${calls}`;
}

// ---------- כלים ----------
async function giveHint() {
  if (!game) return;
  if (game.phase === 'bidding') {
    const c = chooseCall(game.hands[HUMAN], game.auction.calls, game.auction.dealer, game.info.vul);
    toast(`העצה של ${PARTNER.name}: ${c === PASS ? 'פס' : c === DOUBLE ? 'כפל' : c === REDOUBLE ? 'כפל חוזר' : levelOf(c) + STRAIN_SYMBOL[strainOf(c)]}`, 3500);
    if (store.settings.confirm) { selected = c; render(); }
  } else if (game.phase === 'playing') {
    busy = true; render();
    const v = game.playView();
    const c = await ask('card', { view: v, opts: { seed: 7, maxSamples: 32, timeMs: 1800 } });
    busy = false; hintCard = c; selected = store.settings.confirm ? c : null; render();
    toast(`העצה של ${PARTNER.name}: ${rankLabel(rankOf(c))}${SUIT_SYMBOL[suitOf(c)]}`, 3500);
  }
}
function showLastTrick() {
  const h = game.play.history[game.play.history.length - 1];
  if (!h) return;
  const names = seatNames();
  openSheet(`<h2>הלקיחה הקודמת</h2>
    <table>${h.plays.map((p) => `<tr class="${p.seat === h.winner ? 'me' : ''}"><td>${names[p.seat].flag} ${esc(names[p.seat].name)}</td><td style="font-size:1.4em;font-weight:800;color:${suitOf(p.card) === 2 ? 'var(--red)' : suitOf(p.card) === 1 ? 'var(--diamond)' : suitOf(p.card) === 0 ? 'var(--club)' : '#111'}">${rankLabel(rankOf(p.card))}${SUIT_SYMBOL[suitOf(p.card)]}</td><td>${p.seat === h.winner ? '✔ לקח/ה' : ''}</td></tr>`).join('')}</table>
    <div style="height:12px"></div><button class="btn big" data-act="close">סגירה</button>`, () => closeSheet());
}
async function tryClaim() {
  const p = game.play;
  busy = true; render();
  const ok = await ask('claim', { hands: p.hands, trump: p.trump, declarer: p.declarer, leader: p.leader });
  busy = false;
  if (ok) {
    game.claim(13 - p.history.length);
    saveLive();
    toast('מצוין! כל הלקיחות שנותרו שלך');
    runLoop();
  } else { render(); toast('עוד לא בטוח שהכול שלך. כדאי להמשיך לשחק', 3200); }
}

function openMenu() {
  openSheet(`<h2>תפריט</h2>
    <div class="row" style="flex-direction:column;align-items:stretch">
      <button class="btn big" data-act="settings">⚙ הגדרות</button>
      <button class="btn big" data-act="standings">🏅 טבלת הטורניר</button>
      <button class="btn big" data-act="help">? עזרה</button>
      <button class="btn big ghost" data-act="lobby">⌂ חזרה ללובי (הטורניר נשמר)</button>
      <button class="btn big ghost" data-act="close">סגירה</button>
    </div>`, (act) => {
    closeSheet();
    if (act === 'settings') openSettings();
    else if (act === 'standings') openStandings();
    else if (act === 'help') openHelp();
    else if (act === 'lobby') { loopToken++; view = 'lobby'; busy = false; render(); }
  });
}

// ---------- סוף חלוקה ----------
async function finishBoard() {
  const t = store.tournament;
  busy = true; render();
  const res = game.result();
  const field = await fieldPromise;
  const record = {
    boardNo: game.boardNo, ns: res.ns, tricks: res.tricks, contract: res.contract,
    field: field.map((f) => ({ ns: f.ns, tricks: f.tricks, contract: f.contract })),
    calls: game.auction.calls,
  };
  t.results.push(record);
  t.index++;
  t.live = null;
  save();
  busy = false;
  showBoardResult(record);
}

function resultText(ct, tricks) {
  if (!ct) return 'כולם פס';
  const d = tricks - (ct.level + 6);
  return d === 0 ? 'בדיוק' : num(d);
}

function showBoardResult(r) {
  const t = store.tournament;
  const names = ['N', 'E', 'S', 'W'];
  const seatHe = (s) => SEAT_NAME_HE[s];
  const pcts = matchpoints([r.ns, ...r.field.map((f) => f.ns)]);
  const mine = pcts[0];
  const ct = r.contract;
  const weDeclared = ct && sideOf(ct.declarer) === 0;
  let headline;
  if (!ct) headline = 'החלוקה עברה בפס';
  else if (r.tricks >= ct.level + 6) headline = weDeclared ? '✔ עשיתם את החוזה!' : 'היריבים עשו את החוזה';
  else headline = weDeclared ? 'החוזה נפל' : '✔ הפלתם את היריבים!';
  const praise = mine >= 70 ? 'תוצאה מצוינת! 🌟' : mine >= 55 ? 'תוצאה טובה מאוד' : mine >= 40 ? 'תוצאה סבירה, קרוב לממוצע' : 'חלוקה קשה. ממשיכים!';
  const rows = [{ me: true, names: 'את ו' + PARTNER.name, flag: PARTNER.flag, ct, tricks: r.tricks, ns: r.ns, pct: mine },
    ...r.field.map((f, i) => ({ me: false, names: t.field[i].names, flag: t.field[i].flag, ct: f.contract, tricks: f.tricks, ns: f.ns, pct: pcts[i + 1] }))]
    .sort((a, b) => b.ns - a.ns);
  const last = t.index >= t.boards;
  const roundChange = !last && t.index % 2 === 0;
  void names;
  openSheet(`
    <h2>סיום חלוקה ${t.index} מתוך ${t.boards}</h2>
    <div class="big-result">${headline}</div>
    <div class="row center" style="font-size:1.1em">חוזה: <b>${contractHtml(ct)}</b>${ct ? `, מכריז/ה: ${seatHe(ct.declarer)}. ${r.tricks} לקיחות (${resultText(ct, r.tricks)})` : ''}</div>
    <div class="score ${r.ns >= 0 ? 'plus' : 'minus'}">${num(r.ns)}</div>
    <p style="text-align:center;margin:4px 0"><b>${Math.round(mine)}%</b> מול שאר השולחנות · ${praise}</p>
    <div class="pct-bar"><i style="width:${Math.round(mine)}%"></i></div>
    <h3>מה קרה בשאר השולחנות</h3>
    <table><thead><tr><th>זוג</th><th>חוזה</th><th>תוצאה</th><th>ניקוד</th></tr></thead>
    <tbody>${rows.map((x) => `<tr class="${x.me ? 'me' : ''}"><td>${x.flag} ${esc(x.names)}</td><td>${contractHtml(x.ct)}${x.ct ? ' ' + seatHe(x.ct.declarer).slice(0, 1) : ''}</td><td>${x.ct ? resultText(x.ct, x.tricks) : ''}</td><td>${num(x.ns, false)}</td></tr>`).join('')}</tbody></table>
    <div style="height:14px"></div>
    <button class="btn primary big" data-act="next">${last ? '🏆 לתוצאות הטורניר' : 'לחלוקה הבאה ▶'}</button>`,
  () => {
    closeSheet();
    if (last) { view = 'final'; render(); confetti(); }
    else if (roundChange) showRoundIntro();
    else startBoard();
  }).dataset.sticky = '1';
}

function openStandings() {
  const t = store.tournament;
  const st = standings(t);
  openSheet(`<h2>טבלת הטורניר</h2><p>אחרי ${t.results.length} חלוקות</p>${standingsTable(st)}
    <div style="height:12px"></div><button class="btn big" data-act="close">סגירה</button>`, () => closeSheet());
}
function standingsTable(st) {
  return `<table><thead><tr><th>#</th><th>זוג</th><th>אחוז</th></tr></thead><tbody>
    ${st.map((r, i) => `<tr class="${r.me ? 'me' : ''}"><td>${i + 1}</td><td>${r.flag} ${esc(r.names)}</td><td>${r.pct.toFixed(1)}%</td></tr>`).join('')}</tbody></table>`;
}

// ---------- סוף טורניר ----------
function renderFinal() {
  const t = store.tournament;
  const st = standings(t);
  const place = st.findIndex((r) => r.me) + 1;
  const top3 = st.slice(0, 3);
  const msg = place === 1 ? 'אלופת הטורניר! 🏆' : place <= 3 ? `מקום ${place}! על הפודיום 🥇` : `מקום ${place} מתוך ${st.length}`;
  app.innerHTML = `<main class="lobby">
    <div class="brand"><div class="suits">🏆</div><h1>${msg}</h1><div class="sub">${esc(store.settings.name)}, שיחקת ${t.boards} חלוקות מול זוגות מכל העולם</div></div>
    <section class="sheet" style="border-radius:22px">
      <div class="podium">
        <div class="p2">2<br>${top3[1] ? top3[1].flag + ' ' + esc(top3[1].names) : ''}</div>
        <div class="p1">1<br>${top3[0] ? top3[0].flag + ' ' + esc(top3[0].names) : ''}</div>
        <div class="p3">3<br>${top3[2] ? top3[2].flag + ' ' + esc(top3[2].names) : ''}</div>
      </div>
      ${standingsTable(st)}
    </section>
    <button class="btn primary big" data-act="new">🏆 טורניר חדש</button>
    <button class="btn ghost big" data-act="lobby">⌂ ללובי</button>
  </main>`;
  app.onclick = (e) => {
    const b = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-act]'));
    if (!b) return;
    if (b.dataset.act === 'new') newTournament();
    else { view = 'lobby'; render(); }
  };
}
function confetti() {
  const box = document.createElement('div');
  box.className = 'confetti';
  const colors = ['#e3b341', '#c8102e', '#2fa35f', '#1d5fbf', '#ffffff'];
  for (let i = 0; i < 80; i++) {
    const p = document.createElement('i');
    p.style.left = Math.random() * 100 + 'vw';
    p.style.background = colors[i % colors.length];
    p.style.animationDelay = Math.random() * 1.5 + 's';
    box.appendChild(p);
  }
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 5000);
}

// ---------- הגדרות ועזרה ----------
function openSettings() {
  const s = store.settings;
  const seg = (key, opts) => `<div class="seg">${opts.map(([v, l]) => `<button data-act="set" data-k="${key}" data-v="${v}" aria-pressed="${String(s[key]) === String(v)}">${l}</button>`).join('')}</div>`;
  const bg = openSheet(`<h2>הגדרות</h2>
    <div class="setting"><label for="nm">השם שלך</label><input id="nm" type="text" value="${esc(s.name)}" maxlength="20" autocomplete="off"></div>
    <div class="setting"><label>גודל טקסט</label>${seg('scale', [[1, 'רגיל'], [1.15, 'גדול'], [1.3, 'גדול מאוד']])}</div>
    <div class="setting"><label>קצב השחקנים האחרים</label>${seg('speed', [['slow', 'רגוע'], ['normal', 'רגיל'], ['fast', 'מהיר']])}</div>
    <div class="setting"><label>צבעי הסדרות</label>${seg('colors', [[2, 'קלאסי (2 צבעים)'], [4, '4 צבעים']])}</div>
    <div class="setting"><label>אישור לפני כל מהלך</label>${seg('confirm', [[true, 'כן (מומלץ)'], [false, 'לא']])}</div>
    <div class="setting"><label>צלילים</label>${seg('sound', [[true, 'כן'], [false, 'לא']])}</div>
    <div class="setting"><label>להציג ספירת נקודות</label>${seg('showHcp', [[false, 'לא'], [true, 'כן']])}</div>
    <div class="setting"><label>ניגודיות</label>${seg('contrast', [['normal', 'רגילה'], ['high', 'גבוהה']])}</div>
    <div style="height:12px"></div><button class="btn primary big" data-act="close">שמירה</button>`,
  (act, b) => {
    if (act === 'set') {
      const k = b.dataset.k, raw = b.dataset.v;
      const v = raw === 'true' ? true : raw === 'false' ? false : isNaN(Number(raw)) ? raw : Number(raw);
      /** @type {any} */ (s)[k] = v;
      save(); applySettings();
      b.parentElement.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    } else if (act === 'close') {
      const nm = /** @type {HTMLInputElement} */ (bg.querySelector('#nm')).value.trim();
      if (nm) s.name = nm;
      if (store.tournament) store.tournament.playerName = s.name;
      save(); closeSheet(); render();
    }
  });
}
function openHelp() {
  openSheet(`<h2>איך משחקים כאן</h2>
    <ul style="line-height:1.6;padding-inline-start:20px">
      <li>את יושבת בדרום (למטה). השותפה שלך, ${PARTNER.name}, בצפון.</li>
      <li><b>הכרזה:</b> לוחצים על ההכרזה בקופסה ואז על "הכריזי". ירוק = פס, אדום = כפל.</li>
      <li><b>משחק:</b> לוחצים על קלף כדי להרים אותו, ולוחצים שוב כדי לשחק. קלפים שאסור לשחק מוצגים חיוורים.</li>
      <li>כשאת המכריזה, תשחקי גם את הקלפים של הדומם.</li>
      <li><b>💡 עצה</b> מראה מה השותפה הייתה עושה. <b>✋ כל השאר שלי</b> מסיים את החלוקה כשכל הלקיחות שלך.</li>
      <li>הטורניר נשמר אוטומטית. אפשר לסגור ולחזור מתי שרוצים.</li>
      <li>הניקוד: דופליקייט. כל חלוקה מושווית לשולחנות האחרים באחוזים.</li>
    </ul>
    <h3>שיטת ההכרזה של השחקנים</h3>
    <p>שיטה טבעית בסגנון אמריקאי: מייג'ור של 5 קלפים, 1 ללא שליט = 15-17, 2♣ חזק ומלאכותי, פתיחות חסימה חלשות, סטיימן, בלאקווד, כפל הוצאה וכפל שלילי.</p>
    <p class="muted" style="color:#666">את השחקנים האחרים מפעיל מחשב חכם שמשחק ברמת מומחה.</p>
    <button class="btn big" data-act="close">הבנתי</button>`, () => closeSheet());
}

// ---------- הפעלה ----------
applySettings();
if (store.tournament && store.tournament.index >= store.tournament.boards) store.tournament = { ...store.tournament };
render();
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
void NT; void contractText;
