// משחק הקלפים של הבוטים.
// שיטה: דגימת חלוקות אפשריות של הקלפים הנסתרים (מונטה קרלו), פתרון כל חלוקה
// בפותר "דאבל דאמי", ובחירת הקלף עם הממוצע הטוב ביותר. אם הפותר לא זמין - היוריסטיקה.
import { suitOf, rankOf, SUIT_LETTER, sideOf, mulberry32, hcpOfCard, toPbn, cardCode } from '../engine/cards.js';

/** @typedef {{seat:number, card:number}} PlayedCard */
/**
 * @typedef {Object} PlayView
 * @property {number} seat           מי משחק עכשיו (יכול להיות הדומם)
 * @property {number[][]} hands      הידיים שנותרו (כולן; הבוט משתמש רק במה שמותר לו לראות)
 * @property {number} declarer
 * @property {number|null} trump
 * @property {PlayedCard[]} trick    הלקיחה הנוכחית
 * @property {{leader:number, plays:PlayedCard[], winner:number}[]} history
 * @property {number[]} legal
 * @property {{lo:number,hi:number,len:number[],maxLen:number[]}[]} [info]  מידע מההכרזות
 */

const cardStr = cardCode;
const SEAT_L = 'NESW';

const pbnFrom = toPbn;

/** מי שולט במושב: הכרוז שולט גם בדומם */
const controllerOf = (seat, declarer) => (seat === (declarer + 2) % 4 ? declarer : seat);

/**
 * בחירת קלף.
 * @param {PlayView} v
 * @param {any} solver  אובייקט Analyzer של הפותר (או null)
 * @param {{maxSamples?:number, timeMs?:number, seed?:number, blunder?:number}} [opts]
 * @returns {number}
 */
export function chooseCard(v, solver, opts = {}) {
  if (v.legal.length === 1) return v.legal[0];
  // ברמת מועדון: לפעמים משחק "אנושי" פשוט במקום חישוב מעמיק
  if (opts.blunder && mulberry32((opts.seed ?? 1) * 7 + 3)() < opts.blunder) return heuristic(v);
  // קלפים שקולים: אם כל החוקיים באותה סדרה ורצופים - לא משנה
  if (solver) {
    try {
      const c = pimc(v, solver, opts);
      if (c !== null) return c;
    } catch (e) { /* נופלים להיוריסטיקה */ }
  }
  return heuristic(v);
}

// ---------- מונטה קרלו + דאבל דאמי ----------
function pimc(v, solver, opts) {
  const maxSamples = opts.maxSamples ?? 30, timeMs = opts.timeMs ?? 1500;
  const rng = mulberry32(opts.seed ?? 12345);
  const me = controllerOf(v.seat, v.declarer);
  const dummy = (v.declarer + 2) % 4;
  const dummyVisible = v.history.length > 0 || v.trick.length > 0;
  const visible = new Set([me]);
  if (dummyVisible) visible.add(dummy);
  if (me === v.declarer) visible.add(dummy);

  // קלפי הלקיחה הנוכחית חוזרים לידיים כדי לפתור מתחילת הלקיחה
  const trickBack = [[], [], [], []];
  for (const p of v.trick) trickBack[p.seat].push(p.card);
  const hidden = [0, 1, 2, 3].filter((s) => !visible.has(s));
  const unknown = [];
  for (const s of hidden) unknown.push(...v.hands[s]);
  const sizes = hidden.map((s) => v.hands[s].length);

  // חוסרים ידועים: מי שלא הלך אחרי סדרה
  const voids = [new Set(), new Set(), new Set(), new Set()];
  const allTricks = [...v.history.map((t) => t.plays), v.trick];
  for (const plays of allTricks) {
    if (!plays.length) continue;
    const led = suitOf(plays[0].card);
    for (const p of plays.slice(1)) if (suitOf(p.card) !== led) voids[p.seat].add(led);
  }
  // נקודות שכבר שוחקו לכל מושב (כדי לבדוק התאמה למכרז)
  const playedBy = [[], [], [], []];
  for (const plays of allTricks) for (const p of plays) playedBy[p.seat].push(p.card);

  const scores = new Map(v.legal.map((c) => [c, 0]));
  const t0 = Date.now();
  let n = 0, attempts = 0;
  const leader = v.trick.length ? v.trick[0].seat : (v.history.length ? v.history[v.history.length - 1].winner : (v.declarer + 1) % 4);
  const declSide = sideOf(v.declarer);
  const maximize = sideOf(me) === declSide;

  while (n < maxSamples && (n < 4 || Date.now() - t0 < timeMs) && attempts < maxSamples * 40) {
    attempts++;
    const strict = attempts < maxSamples * 20; // בהתחלה מקפידים על המכרז, אחר כך מרפים
    const deal = sampleHidden(unknown, hidden, sizes, voids, rng);
    if (!deal) continue;
    if (strict && v.info && !fitsAuction(deal, hidden, playedBy, v.info)) continue;
    const hands = v.hands.map((h, s) => [...h, ...trickBack[s]]);
    hidden.forEach((s, i) => { hands[s] = [...deal[i], ...trickBack[s]]; });
    const req = {
      dealstr: pbnFrom(hands), trump: v.trump === null ? 'N' : SUIT_LETTER[v.trump],
      declarer: SEAT_L[v.declarer], leader: SEAT_L[leader],
      plays: [...v.trick.map((p) => cardStr(p.card)), cardStr(v.legal[0])],
    };
    const res = JSON.parse(solver.dd_play_node(JSON.stringify(req), v.trick.length));
    for (const alt of res.alternatives) {
      const c = v.legal.find((x) => cardStr(x) === alt.card);
      if (c !== undefined) scores.set(c, scores.get(c) + alt.tricks);
    }
    n++;
  }
  if (!n) return null;
  if (typeof solver.clear_cache === 'function' && solver.cached_positions > 200000) solver.clear_cache();
  // הטוב ביותר; בשוויון - הקלף הנמוך (לא מבזבזים גבוהים)
  let best = null, bestScore = -Infinity;
  for (const c of v.legal) {
    const sc = (maximize ? 1 : -1) * scores.get(c);
    if (sc > bestScore + 1e-9 || (Math.abs(sc - bestScore) < 1e-9 && preferLower(c, best))) { best = c; bestScore = sc; }
  }
  return best;
}
function preferLower(c, best) {
  if (best === null) return true;
  // בשוויון: עדיף קלף נמוך; בין סדרות - מהסדרה הארוכה יותר אין לנו מידע, אז לפי דרגה
  return rankOf(c) < rankOf(best);
}

function sampleHidden(unknown, hidden, sizes, voids, rng) {
  for (let tries = 0; tries < 20; tries++) {
    const cards = [...unknown];
    for (let i = cards.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [cards[i], cards[j]] = [cards[j], cards[i]]; }
    const out = hidden.map(() => []);
    const left = [...sizes];
    let ok = true;
    // קודם קלפים שרק מושב אחד יכול לקבל
    cards.sort((a, b) => countAllowed(a, hidden, voids) - countAllowed(b, hidden, voids));
    for (const c of cards) {
      const opts = hidden.map((s, i) => i).filter((i) => left[i] > 0 && !voids[hidden[i]].has(suitOf(c)));
      if (!opts.length) { ok = false; break; }
      const i = opts[Math.floor(rng() * opts.length)];
      out[i].push(c); left[i]--;
    }
    if (ok) return out;
  }
  return null;
}
const countAllowed = (c, hidden, voids) => hidden.filter((s) => !voids[s].has(suitOf(c))).length;

function fitsAuction(deal, hidden, playedBy, info) {
  for (let i = 0; i < hidden.length; i++) {
    const s = hidden[i], p = info[s];
    if (!p) continue;
    const full = [...deal[i], ...playedBy[s]];
    if (full.length !== 13) continue;
    const hcp = full.reduce((a, c) => a + hcpOfCard(c), 0);
    if (hcp < p.lo - 1 || hcp > p.hi + 1) return false;
    const len = [0, 0, 0, 0];
    for (const c of full) len[suitOf(c)]++;
    for (let x = 0; x < 4; x++) if (len[x] < p.len[x] || len[x] > p.maxLen[x]) return false;
  }
  return true;
}

// ---------- היוריסטיקה (גיבוי) ----------
/** @param {PlayView} v */
export function heuristic(v) {
  const legal = [...v.legal].sort((a, b) => rankOf(a) - rankOf(b));
  if (!v.trick.length) {
    // הובלה: מהסדרה הארוכה, הגבוה אם יש רצף מכובדים, אחרת נמוך
    const bySuit = [0, 1, 2, 3].map((s) => legal.filter((c) => suitOf(c) === s));
    const nonTrump = bySuit.filter((x, s) => x.length && s !== v.trump);
    const pool = nonTrump.length ? nonTrump : bySuit.filter((x) => x.length);
    const longest = pool.sort((a, b) => b.length - a.length)[0];
    const top = longest[longest.length - 1], second = longest[longest.length - 2];
    if (second !== undefined && rankOf(top) >= 12 && rankOf(top) - rankOf(second) === 1) return top;
    return longest[0];
  }
  const led = suitOf(v.trick[0].card);
  const win = winningPlay(v.trick, v.trump);
  const partnerWinning = sideOf(win.seat) === sideOf(v.seat);
  const beats = (c) => suitOf(c) === suitOf(win.card) ? rankOf(c) > rankOf(win.card)
    : (v.trump !== null && suitOf(c) === v.trump && suitOf(win.card) !== v.trump);
  const following = suitOf(legal[0]) === led && legal.every((c) => suitOf(c) === led);
  if (partnerWinning && v.trick.length >= 2) return following ? legal[0] : discard(legal, v.trump);
  const winners = legal.filter(beats);
  if (winners.length && (v.trick.length === 3 || v.trick.length === 2 || !following)) return winners[0];
  return following ? legal[0] : discard(legal, v.trump);
}
function discard(legal, trump) {
  const non = legal.filter((c) => suitOf(c) !== trump);
  return (non.length ? non : legal)[0];
}
function winningPlay(trick, trump) {
  let best = trick[0];
  for (const p of trick.slice(1)) {
    if (suitOf(p.card) === suitOf(best.card)) { if (rankOf(p.card) > rankOf(best.card)) best = p; }
    else if (trump !== null && suitOf(p.card) === trump) best = p;
  }
  return best;
}
