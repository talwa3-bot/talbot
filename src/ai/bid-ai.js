// מנוע הכרזות לבוטים: שיטה טבעית בסגנון אמריקאי סטנדרטי (SAYC מקוצר).
// מייג'ור של 5 קלפים, 1NT = 15-17, סטיימן, בלאקווד, הכרזות מעל יריב, כפל הוצאה.
// כל בוט מסיק מההכרזות הקודמות טווח נקודות ואורכי סדרות של כל שחקן, ומחליט
// על הכרזה לפי כוח משותף משוער מול הכוח הנדרש לכל גובה.
import { suitOf, rankOf, hcpOfCard, sideOf, partnerOf, NT } from '../engine/cards.js';
import { Auction, PASS, DOUBLE, REDOUBLE, bid, isBid, levelOf, strainOf } from '../engine/bidding.js';

const C = 0, D = 1, H = 2, S = 3;
const isMajor = (s) => s === H || s === S;

// כוח משותף נדרש לכל גובה (אינדקס = גובה)
const NEED_MAJOR = [0, 0, 18, 22, 25, 28, 32, 36];
const NEED_MINOR = [0, 0, 18, 22, 26, 28, 32, 36];
const NEED_NT = [0, 17, 22, 25, 31, 99, 33, 37];
export function need(level, strain) {
  if (strain === NT) return NEED_NT[level];
  return (isMajor(strain) ? NEED_MAJOR : NEED_MINOR)[level];
}
const gameLevel = (strain) => (strain === NT ? 3 : isMajor(strain) ? 4 : 5);

// ---------- תכונות היד ----------
export function features(hand) {
  const len = [0, 0, 0, 0], hcpS = [0, 0, 0, 0], ranks = [[], [], [], []];
  let hcp = 0;
  for (const c of hand) {
    const s = suitOf(c);
    len[s]++; hcpS[s] += hcpOfCard(c); hcp += hcpOfCard(c);
    ranks[s].push(rankOf(c));
  }
  ranks.forEach((r) => r.sort((a, b) => b - a));
  const sorted = [...len].sort((a, b) => b - a);
  const bal = len.every((l) => l >= 2) && len.filter((l) => l === 2).length <= 1 && sorted[0] <= 5;
  const aces = hand.filter((c) => rankOf(c) === 14).length;
  return { len, hcp, hcpS, ranks, bal, aces, sorted };
}
const lengthPts = (f) => f.len.reduce((a, l) => a + Math.max(0, l - 4), 0);
const shortPts = (f, trump) => f.len.reduce((a, l, s) => (s === trump ? a : a + (l === 0 ? 3 : l === 1 ? 2 : l === 2 ? 1 : 0)), 0);
const topHonors = (f, s, n = 3) => f.ranks[s].filter((r) => r >= 15 - n).length; // מתוך A,K,Q (n=3)
function stopper(f, s) {
  const r = f.ranks[s], l = f.len[s];
  return r.includes(14) || (r.includes(13) && l >= 2) || (r.includes(12) && l >= 3) || (r.includes(11) && l >= 4);
}

// ---------- הסקה מההכרזות ----------
function blank() { return { lo: 0, hi: 37, len: [0, 0, 0, 0], maxLen: [13, 13, 13, 13], bal: false, forcing: false }; }
export const est = (p) => p.lo + Math.min(2, (p.hi - p.lo) / 2);
function setRange(p, lo, hi = 37) { p.lo = Math.max(p.lo, lo); p.hi = Math.max(p.lo, Math.min(p.hi, hi)); }
function setLen(p, s, n) { p.len[s] = Math.max(p.len[s], n); }
function setBal(p) { p.bal = true; for (let s = 0; s < 4; s++) { setLen(p, s, 2); p.maxLen[s] = Math.min(p.maxLen[s], 5); } }

// מצב המכרז מנקודת המבט של מושב מסוים, לפני הקריאה שלו
function situation(calls, dealer, seat) {
  const bids = [];
  calls.forEach((c, i) => { if (isBid(c)) bids.push({ i, seat: (dealer + i) % 4, call: c }); });
  const mine = (b) => sideOf(b.seat) === sideOf(seat);
  const opening = bids[0] || null;
  const ourBids = bids.filter(mine), theirBids = bids.filter((b) => !mine(b));
  const partnerBids = ourBids.filter((b) => b.seat !== seat), myBids = ourBids.filter((b) => b.seat === seat);
  const myCalls = calls.map((c, i) => ({ c, i, seat: (dealer + i) % 4 })).filter((x) => x.seat === seat && x.c !== PASS);
  const partnerCalls = calls.map((c, i) => ({ c, i, seat: (dealer + i) % 4 })).filter((x) => x.seat === partnerOf(seat) && x.c !== PASS);
  const lastBid = bids[bids.length - 1] || null;
  return { bids, opening, ourBids, theirBids, partnerBids, myBids, myCalls, partnerCalls, lastBid, seat };
}

// הגובה הזול ביותר שבו אפשר להכריז על סדרה
function cheapest(lastCall, strain) {
  if (lastCall == null) return 1;
  const l = levelOf(lastCall);
  return bid(l, strain) > lastCall ? l : l + 1;
}

// מפענח את כל המכרז: מחזיר מידע על כל מושב + מטא-מידע (סטיימן, בלאקווד, מחייב-משחק)
export function interpret(calls, dealer) {
  const info = [blank(), blank(), blank(), blank()];
  const meta = { gameForce: [false, false], blackwood: null };
  for (let i = 0; i < calls.length; i++) {
    const seat = (dealer + i) % 4, call = calls[i];
    const sit = situation(calls.slice(0, i), dealer, seat);
    applyMeaning(info, meta, sit, seat, call, calls.slice(0, i));
  }
  return { info, meta };
}

function applyMeaning(info, meta, sit, seat, call, prior) {
  const me = info[seat], P = info[partnerOf(seat)];
  const last = sit.lastBid ? sit.lastBid.call : null;
  const partnerOpened = sit.opening && sit.opening.seat === partnerOf(seat);
  const iOpened = sit.opening && sit.opening.seat === seat;
  me.forcing = false;

  // --- פס ---
  if (call === PASS) {
    if (!sit.opening) me.hi = Math.min(me.hi, 11);
    else if (partnerOpened && sit.myCalls.length === 0) {
      const oc = sit.opening.call;
      const interfered = sit.theirBids.length > 0;
      if (levelOf(oc) === 1 && strainOf(oc) !== NT) me.hi = Math.min(me.hi, interfered ? 8 : 5);
      else if (oc === bid(1, NT)) me.hi = Math.min(me.hi, 7);
    } else if (sit.ourBids.length === 0) me.hi = Math.min(me.hi, 14);
    return;
  }
  if (call === REDOUBLE) { setRange(me, 10); return; }

  // --- כפל ---
  if (call === DOUBLE) {
    const lb = sit.lastBid;
    if (sit.ourBids.length === 0 && levelOf(lb.call) <= 3 && strainOf(lb.call) !== NT) {
      setRange(me, 12); // כפל הוצאה
      const theirSuits = new Set(sit.theirBids.map((b) => strainOf(b.call)));
      for (let s = 0; s < 4; s++) if (!theirSuits.has(s)) setLen(me, s, 3); else me.maxLen[s] = Math.min(me.maxLen[s], 2);
      me.takeout = true;
    } else if (partnerOpened && sit.myBids.length === 0 && levelOf(lb.call) <= 2 && strainOf(lb.call) !== NT) {
      setRange(me, 7); // כפל שלילי
      const used = new Set(sit.bids.map((b) => strainOf(b.call)));
      for (const s of [H, S]) if (!used.has(s)) setLen(me, s, 4);
    } else setRange(me, 8);
    return;
  }

  const L = levelOf(call), st = strainOf(call);
  const myPrevSuits = new Set(sit.myBids.map((b) => strainOf(b.call)));
  const partnerSuits = new Set(sit.partnerBids.map((b) => strainOf(b.call)));
  const minL = cheapest(last, st);
  const jump = L - minL;

  // בלאקווד
  if (call === bid(4, NT) && sit.ourBids.length && strainOf(sit.ourBids[sit.ourBids.length - 1].call) !== NT) {
    meta.blackwood = { asker: seat, trump: strainOf(sit.ourBids[sit.ourBids.length - 1].call) };
    return;
  }
  if (meta.blackwood && meta.blackwood.asker === partnerOf(seat) && last === bid(4, NT) && L === 5 && st !== NT) {
    meta.blackwood.reply = st; return;
  }

  // --- פתיחה ---
  if (!sit.opening) {
    if (st === NT) {
      if (L === 1) { setRange(me, 15, 17); setBal(me); }
      else if (L === 2) { setRange(me, 20, 21); setBal(me); }
      else setRange(me, 25, 27);
    } else if (L === 1) { setRange(me, 12, 21); setLen(me, st, isMajor(st) ? 5 : st === D ? 4 : 3); }
    else if (L === 2 && st === C) { setRange(me, 22); meta.gameForce[sideOf(seat)] = true; me.strong2C = true; }
    else { setRange(me, 5, 10); setLen(me, st, L + 4); me.preempt = true; }
    return;
  }

  // --- הכרזה מעל פתיחת יריב (הצד שלנו עוד לא הכריז) ---
  if (sit.ourBids.length === 0) {
    if (st === NT && L === 1) { setRange(me, 15, 18); setBal(me); }
    else if (st === NT) { setRange(me, 15, 18); }
    else if (jump >= 1) { setRange(me, 5, 10); setLen(me, st, 6 + Math.min(jump - 1, 1)); me.preempt = true; }
    else if (L === 1) { setRange(me, 8, 16); setLen(me, st, 5); }
    else { setRange(me, 11, 16); setLen(me, st, 5); }
    return;
  }

  // --- תגובה ראשונה לפתיחת השותף ---
  if (partnerOpened && sit.myBids.length === 0 && !P.takeout) {
    const oc = sit.opening.call, os = strainOf(oc), ol = levelOf(oc);
    if (oc === bid(1, NT) || oc === bid(2, NT)) {
      const base = ol === 1 ? 0 : 3; // 2NT פתיחה: אותם סוגי תגובות גבוה בדרגה
      if (L === ol + 1 && st === C) { setRange(me, ol === 1 ? 8 : 4); me.stayman = true; me.forcing = true; }
      else if (L === 2 && ol === 1 && st !== NT) { setRange(me, 0, 7); setLen(me, st, 5); }
      else if (st === NT && L === ol + 1) { setRange(me, 8 - base * 1.5, 9 - base); }
      else if (st === NT && L === 3) { setRange(me, 10 - base * 2, 15 - base); }
      else if (st === NT && L === 4) { setRange(me, 16 - base * 1.5, 17 - base * 1.5); }
      else if (st === NT && L >= 6) { setRange(me, 18 - base * 2); }
      else if (L === 3) { setRange(me, 10 - base * 2); setLen(me, st, 5); me.forcing = true; }
      else if (L === 4 && isMajor(st)) { setRange(me, 10 - base * 2, 15); setLen(me, st, 6); }
      return;
    }
    if (P.strong2C) {
      if (call === bid(2, D)) setRange(me, 0, 7);
      else if (st === NT) { setRange(me, 8); setBal(me); }
      else { setRange(me, 8); setLen(me, st, 5); }
      return;
    }
    if (P.preempt) {
      if (st === os) setLen(me, st, 3);
      else { setRange(me, 15); setLen(me, st, 5); me.forcing = true; }
      return;
    }
    // פתיחה של 1 בסדרה
    if (st === os) {
      setLen(me, st, isMajor(st) ? 3 : 4);
      if (L === 2) setRange(me, 6, 9); else if (L === 3) setRange(me, 10, 12); else setRange(me, 13, 15);
    } else if (st === NT) {
      if (L === 1) setRange(me, 6, 10); else if (L === 2) { setRange(me, 11, 12); setBal(me); } else { setRange(me, 13, 15); setBal(me); }
    } else if (jump >= 1) { setRange(me, 17); setLen(me, st, 5); me.forcing = true; }
    else if (L === 1) { setRange(me, 6); setLen(me, st, 4); me.forcing = true; }
    else { setRange(me, 10); setLen(me, st, isMajor(st) ? 5 : 4); me.forcing = true; }
    return;
  }

  // --- מתקדם אחרי כפל הוצאה של השותף ---
  if (P.takeout && sit.myBids.length === 0) {
    if (st === NT) { setRange(me, L === 1 ? 6 : 11, L === 1 ? 10 : 12); }
    else { setLen(me, st, 4); setRange(me, jump >= 1 ? 9 : 0, jump >= 1 ? 12 : 8); if (L >= 4) setRange(me, 12); }
    return;
  }

  // --- תשובה לסטיימן ---
  if (P.stayman && iOpened && sit.myBids.length === 1) {
    if (st === D) { me.maxLen[H] = 3; me.maxLen[S] = 3; }
    else if (st === H || st === S) setLen(me, st, 4);
    P.stayman = false;
    return;
  }

  // --- ההכרזה החוזרת של הפותח ---
  if (iOpened && sit.myBids.length === 1 && !me.strong2C) {
    const os = strainOf(sit.opening.call);
    if (st === NT) {
      if (jump === 0 && L <= 2 && L === 1) { setRange(me, 12, 14); setBal(me); return; }
      if (L === 2) { setRange(me, jump ? 18 : 12, jump ? 19 : 15); setBal(me); return; }
      if (L === 3) { setRange(me, 18, 21); setBal(me); return; }
    }
    if (st === os) { setLen(me, st, 6); jump ? setRange(me, 16, 18) : setRange(me, 12, 15); return; }
    if (partnerSuits.has(st)) {
      setLen(me, st, isMajor(st) ? 4 : 4);
      setRange(me, jump === 0 ? 12 : jump === 1 ? 16 : 19, jump === 0 ? 15 : jump === 1 ? 18 : 21);
      return;
    }
    setLen(me, st, 4); setLen(me, os, isMajor(os) ? 5 : 4);
    const reverse = L === 2 && st > os;
    if (jump >= 1) setRange(me, 19); else if (reverse) setRange(me, 16);
    me.forcing = jump >= 1 || reverse;
    return;
  }

  // --- 2C חזק: ההכרזה החוזרת ---
  if (me.strong2C && sit.myBids.length === 1) {
    if (st === NT) { setBal(me); L === 2 ? setRange(me, 22, 24) : setRange(me, 25, 27); }
    else setLen(me, st, 5);
    return;
  }

  // --- כללי: הכרזה טבעית בסבב מאוחר ---
  const pEst = est(P);
  if (st !== NT) {
    if (myPrevSuits.has(st)) setLen(me, st, Math.max(me.len[st] + 1, 5));
    else if (partnerSuits.has(st)) setLen(me, st, P.len[st] >= 5 ? 3 : 4);
    else { setLen(me, st, 4); me.forcing = !sit.theirBids.length; return; }
  }
  if (jump >= 1 || partnerSuits.has(st) || st === NT) {
    const n = need(L, st);
    if (n < 99) setRange(me, Math.max(0, Math.floor(n - pEst - 1)));
  }
  if (jump === 0 && L < gameLevel(st)) {
    const nn = need(L + 1, st);
    if (nn < 99) me.hi = Math.max(me.lo, Math.min(me.hi, Math.ceil(nn - pEst + 1)));
  }
  void prior;
}

// ---------- מדיניות ההכרזה ----------
export function chooseCall(hand, calls, dealer, vul, opts = {}) {
  const A = new Auction(dealer, calls);
  const seat = A.turn;
  const f = features(hand);
  f.adj = opts.adjust || 0; // סטייה קטנה בהערכה, לגיוון תוצאות השדה
  const { info, meta } = interpret(calls, dealer);
  const sit = situation(calls, dealer, seat);
  const ctx = { A, seat, f, info, meta, sit, vul: vul || [false, false], me: info[seat], P: info[partnerOf(seat)] };
  let call;
  try { call = decide(ctx); } catch (e) { if (opts.debug) throw e; call = PASS; }
  if (call == null || !A.isLegal(call)) call = PASS;
  return call;
}

function decide(ctx) {
  const { sit, P, meta, seat } = ctx;
  if (!sit.opening) return openingCall(ctx);

  // בלאקווד: תשובה ושאילה
  const bw = meta.blackwood;
  if (bw && bw.asker === partnerOf(seat) && sit.lastBid.call === bid(4, NT) && bw.reply === undefined) {
    const a = ctx.f.aces;
    return bid(5, [C, D, H, S, C][a]);
  }
  if (bw && bw.asker === seat && bw.reply !== undefined && sit.lastBid.seat === partnerOf(seat)) {
    let pa = bw.reply === C ? (ctx.f.aces === 0 ? 4 : 0) : bw.reply; // D=1 H=2 S=3
    const total = ctx.f.aces + pa;
    if (total >= 3) return bid(6, bw.trump);
    const signoff = bid(5, bw.trump);
    return signoff > sit.lastBid.call ? signoff : PASS;
  }

  if (P.takeout && sit.myBids.length === 0 && sit.partnerCalls.length && sit.partnerCalls[sit.partnerCalls.length - 1].c === DOUBLE) return advanceTakeout(ctx);
  if (sit.ourBids.length === 0) return defensiveCall(ctx);
  const partnerOpened = sit.opening.seat === partnerOf(seat);
  if (partnerOpened && sit.myBids.length === 0 && sit.myCalls.length === 0) {
    const r = respond(ctx);
    if (r !== undefined) return r;
  }
  const iOpened = sit.opening.seat === seat;
  if (iOpened && sit.myBids.length === 1) {
    const r = openerRebid(ctx);
    if (r !== undefined) return r;
  }
  if (partnerOpened && sit.myBids.length === 1 && sit.myBids[0].call === bid(levelOf(sit.opening.call) + 1, C)
      && (sit.opening.call === bid(1, NT) || sit.opening.call === bid(2, NT)) && sit.myCalls.length === 1) {
    return afterStayman(ctx);
  }
  return generic(ctx);
}

// ---------- פתיחה ----------
function openingCall(ctx) {
  const { f, A } = ctx;
  const pos = A.calls.length; // כמה פסים לפני
  const hcp = f.hcp + f.adj;
  const rule20 = hcp + f.sorted[0] + f.sorted[1] >= 20;
  if (f.bal && hcp >= 15 && hcp <= 17) return bid(1, NT);
  if (f.bal && hcp >= 20 && hcp <= 21) return bid(2, NT);
  if (hcp >= 22) return bid(2, C);
  const canOpen = hcp >= 12 || (hcp >= 10 && rule20 && pos < 3);
  if (canOpen) {
    if (pos === 3 && hcp + f.len[S] < 15) return PASS; // כלל 15 במושב רביעי
    return bid(1, openingSuit(f));
  }
  // פתיחות חוסמות
  if (pos < 3 && hcp >= 5 && hcp <= 10) {
    for (const s of [S, H, D, C]) {
      const l = f.len[s];
      const good = topHonors(f, s, 4) >= 2;
      if (l >= 8 && isMajor(s) && good) return bid(4, s);
      if (l >= 7 && good) return bid(3, s);
      if (l === 6 && s !== C && good && f.sorted[1] <= 4) return bid(2, s);
    }
  }
  return PASS;
}
function openingSuit(f) {
  const { len } = f;
  if (len[S] >= 5 || len[H] >= 5) return len[S] >= len[H] ? S : H;
  if (len[D] > len[C]) return D;
  if (len[C] > len[D]) return C;
  return len[C] === 3 ? C : D;
}

// ---------- הכרזה מעל פתיחת יריב ----------
function defensiveCall(ctx) {
  const { f, sit, A } = ctx;
  const lb = sit.lastBid;
  const lastC = lb.call, ll = levelOf(lastC), ls = strainOf(lastC);
  const theirSuits = new Set(sit.theirBids.map((b) => strainOf(b.call)).filter((s) => s !== NT));
  const balancing = A.calls.length >= 3 && A.calls[A.calls.length - 1] === PASS && A.calls[A.calls.length - 2] === PASS;
  const hcp = f.hcp + f.adj + (balancing ? 3 : 0);

  if (ll >= 4) return PASS;
  // 1NT מעל
  if (ll === 1 && ls !== NT && f.bal && hcp >= 15 && hcp <= 18 && [...theirSuits].every((s) => stopper(f, s))) return bid(1, NT);
  // כפל הוצאה
  if (ls !== NT && ll <= 3) {
    const unbid = [0, 1, 2, 3].filter((s) => !theirSuits.has(s));
    const shape = [...theirSuits].every((s) => f.len[s] <= 2) && unbid.every((s) => f.len[s] >= 3);
    if ((hcp >= 12 && shape) || hcp >= 17) return DOUBLE;
  }
  // הכרזת סדרה
  const cands = [S, H, D, C].filter((s) => !theirSuits.has(s) && f.len[s] >= 5)
    .sort((a, b) => f.len[b] - f.len[a] || b - a);
  for (const s of cands) {
    const minL = cheapest(lastC, s);
    const good = topHonors(f, s, 4) >= 2;
    if (f.len[s] >= 6 && hcp >= 5 && hcp <= 10 && good && ll === 1) {
      const lvl = f.len[s] >= 7 ? 3 : minL + 1;
      if (lvl <= 3) return bid(lvl, s);
    }
    if (minL === 1 && hcp >= 8 && hcp <= 16 && (good || f.len[s] >= 6 || hcp >= 11)) return bid(1, s);
    if (minL === 2 && hcp >= 11 && hcp <= 16 && (good || f.len[s] >= 6)) return bid(2, s);
    if (minL === 3 && hcp >= 13 && f.len[s] >= 6 && good) return bid(3, s);
  }
  return PASS;
}

function advanceTakeout(ctx) {
  const { f, sit } = ctx;
  const lastC = sit.lastBid.call;
  const theirSuits = new Set(sit.theirBids.map((b) => strainOf(b.call)).filter((s) => s !== NT));
  const pd = sit.partnerCalls[sit.partnerCalls.length - 1];
  const partnerDoubledLast = pd && pd.c === DOUBLE && pd.i > sit.lastBid.i;
  const hcp = f.hcp + f.adj;
  const s = [S, H, D, C].filter((x) => !theirSuits.has(x)).sort((a, b) => f.len[b] - f.len[a] || (isMajor(b) - isMajor(a)))[0];
  const minL = cheapest(lastC, s);
  // אחרי שהיריב הכריז שוב, כבר לא חייבים
  if (!partnerDoubledLast && hcp < 6) return PASS;
  if (hcp >= 12 && isMajor(s) && f.len[s] >= 4) return bid(Math.max(4, minL), s);
  if (hcp >= 6 && f.bal && [...theirSuits].every((x) => stopper(f, x)) && f.len[s] <= 4) {
    const nt = hcp >= 11 ? bid(cheapest(lastC, NT) + 1, NT) : bid(cheapest(lastC, NT), NT);
    if (levelOf(nt) <= 3) return nt;
  }
  if (hcp >= 9 && minL <= 2) return bid(minL + 1, s);
  return bid(minL, s);
}

// ---------- תגובה לפתיחת השותף ----------
function respond(ctx) {
  const { f, sit, A } = ctx;
  const oc = sit.opening.call, os = strainOf(oc), ol = levelOf(oc);
  const hcp = f.hcp + f.adj;
  const interfered = sit.theirBids.length > 0;
  const lastC = sit.lastBid.call;
  const legal = (c) => A.isLegal(c);

  if ((oc === bid(1, NT) || oc === bid(2, NT)) && !interfered) {
    const k = ol === 1 ? 0 : 1; // 2NT: ספים נמוכים יותר
    const minGame = k ? 4 : 10, inv = k ? 99 : 8;
    const longMajor = [S, H].find((s) => f.len[s] >= 5);
    const four = [S, H].some((s) => f.len[s] === 4);
    if (k === 0 && hcp < 8 && longMajor !== undefined) return bid(2, longMajor);
    if (hcp < (k ? 4 : 8)) return PASS;
    if (longMajor !== undefined && f.len[longMajor] >= 6 && hcp >= minGame && hcp <= 15) return bid(4, longMajor);
    if (hcp >= (k ? 13 : 18)) return bid(6, NT);
    if (hcp >= (k ? 11 : 16)) return bid(4, NT);
    if (four && !f.len.some((l) => l <= 1) || (four && hcp >= minGame)) return bid(ol + 1, C);
    if (longMajor !== undefined && hcp >= minGame) return bid(3, longMajor);
    if (hcp >= minGame) return bid(3, NT);
    if (hcp >= inv) return bid(2, NT);
    return PASS;
  }
  if (ctx.P.strong2C) {
    if (interfered) return undefined;
    if (hcp >= 8) {
      const s = [S, H, D, C].find((x) => f.len[x] >= 5 && topHonors(f, x) >= 1);
      if (s !== undefined) return bid(s >= H ? 2 : 3, s);
      if (f.bal) return bid(2, NT);
    }
    return bid(2, D);
  }
  if (ol >= 2 && os !== NT) return undefined; // תגובה לחסימה: כללי
  if (ol !== 1 || os === NT) return undefined;

  // פתיחה של 1 בסדרה
  const support = f.len[os] >= (isMajor(os) ? 3 : 5);
  const dummyPts = hcp + (support ? shortPts(f, os) : 0);
  const unbidByAll = (s) => !sit.bids.some((b) => strainOf(b.call) === s);

  if (hcp < 6 && !(support && dummyPts >= 6)) return PASS;

  // כפל שלילי
  if (interfered && levelOf(lastC) <= 2 && strainOf(lastC) !== NT && A.isLegal(DOUBLE) && hcp >= 7) {
    const um = [H, S].filter((s) => unbidByAll(s) && f.len[s] >= 4);
    const fiveSuit = [S, H, D, C].find((s) => unbidByAll(s) && f.len[s] >= 5 && legal(bid(cheapest(lastC, s), s))
      && (cheapest(lastC, s) === 1 || hcp >= 11));
    if (um.length && fiveSuit === undefined && !(support && isMajor(os))) return DOUBLE;
  }

  if (support && isMajor(os)) {
    if (dummyPts >= 13 && dummyPts <= 15) return pickLegal(A, [bid(4, os)]);
    if (dummyPts >= 16) {
      const ns = [S, H, D, C].find((s) => s !== os && f.len[s] >= 4 && unbidByAll(s));
      if (ns !== undefined && !interfered) return bid(cheapest(lastC, ns) + (cheapest(lastC, ns) === 1 ? 0 : 0), ns);
      return pickLegal(A, [bid(4, os)]);
    }
    if (dummyPts >= 10) return pickLegal(A, [bid(3, os), bid(4, os)]);
    return pickLegal(A, [bid(2, os), PASS]);
  }

  // סדרה חדשה בגובה 1 (מייג'ור קודם)
  const oneLevel = [H, S].filter((s) => s > os && f.len[s] >= 4 && legal(bid(1, s)));
  if (os < H || (os === H && f.len[S] >= 4)) {
    if (oneLevel.length) {
      const pick = oneLevel.reduce((a, b) => (f.len[b] > f.len[a] ? b : a));
      const choose = f.len[H] >= 4 && f.len[S] >= 4 && f.len[H] === f.len[S] && legal(bid(1, H)) && os < H ? H : pick;
      if (hcp >= 6) return bid(1, choose);
    }
  }
  if (os === C && f.len[D] >= 4 && legal(bid(1, D)) && f.len[H] < 4 && f.len[S] < 4 && !f.bal) return bid(1, D);
  // תמיכה במיינור
  if (support && !isMajor(os) && f.len[os] >= 5 && !interfered) {
    if (hcp >= 13) return undefined;
    if (hcp >= 10) return bid(3, os);
    return bid(2, os);
  }
  // סדרה חדשה בגובה 2
  if (hcp >= 10) {
    const two = [S, H, D, C].filter((s) => s !== os && unbidByAll(s) && f.len[s] >= (isMajor(s) ? 5 : 4))
      .sort((a, b) => f.len[b] - f.len[a] || b - a);
    for (const s of two) {
      const c = bid(cheapest(lastC, s), s);
      if (levelOf(c) <= 2 && legal(c)) return c;
    }
  }
  // ללא שליט
  const stoppersOk = sit.theirBids.every((b) => strainOf(b.call) === NT || stopper(f, strainOf(b.call)));
  if (stoppersOk) {
    if (hcp >= 13 && f.bal) return pickLegal(A, [bid(3, NT)]);
    if (hcp >= 11 && f.bal) return pickLegal(A, [bid(2, NT), bid(3, NT)]);
    if (hcp >= (interfered ? 8 : 6) && hcp <= 10) return pickLegal(A, [bid(1, NT), PASS]);
  }
  if (hcp >= 13) return undefined;
  if (support) return pickLegal(A, [bid(2, os), PASS]);
  return interfered ? PASS : pickLegal(A, [bid(1, NT), PASS]);
}
function pickLegal(A, list) { for (const c of list) if (A.isLegal(c)) return c; return PASS; }

// ---------- ההכרזה החוזרת של הפותח ----------
function openerRebid(ctx) {
  const { f, sit, A, P, me } = ctx;
  const oc = sit.opening.call, os = strainOf(oc), ol = levelOf(oc);
  const hcp = f.hcp + f.adj;
  const lastC = sit.lastBid.call;
  const pLast = sit.partnerCalls[sit.partnerCalls.length - 1];
  if (!pLast) return undefined;

  if (oc === bid(1, NT) || oc === bid(2, NT)) {
    if (pLast.c === bid(ol + 1, C) && sit.lastBid.seat === partnerOf(ctx.seat)) { // תשובה לסטיימן
      if (f.len[H] >= 4) return bid(ol + 1, H);
      if (f.len[S] >= 4) return bid(ol + 1, S);
      return bid(ol + 1, D);
    }
    if (ol === 1 && [bid(2, D), bid(2, H), bid(2, S)].includes(pLast.c)) return PASS;
    return undefined;
  }
  if (me.strong2C) {
    if (f.bal && hcp <= 24) return pickLegal(A, [bid(2, NT), bid(3, NT)]);
    if (f.bal) return pickLegal(A, [bid(3, NT)]);
    const s = [S, H, D, C].sort((a, b) => f.len[b] - f.len[a] || b - a)[0];
    const pSuit = isBid(pLast.c) && strainOf(pLast.c) !== NT ? strainOf(pLast.c) : null;
    if (pSuit !== null && f.len[pSuit] >= 3 && pSuit !== D) return bid(cheapest(lastC, pSuit), pSuit);
    return bid(cheapest(lastC, s), s);
  }
  if (ol !== 1 || os === NT || P.takeout) return undefined;
  if (!isBid(pLast.c)) return undefined; // כפל שלילי וכד': כללי

  const ps = strainOf(pLast.c);
  // השותף תמך: כללי יחליט אם להזמין/משחק
  if (ps === os) return undefined;
  const pts = hcp + lengthPts(f);
  if (ps === NT) {
    if (levelOf(pLast.c) >= 2) return undefined;
    if (f.bal) { if (hcp >= 18) return pickLegal(A, [bid(3, NT)]); if (hcp >= 16) return pickLegal(A, [bid(2, NT)]); return PASS; }
  } else {
    // תמיכה בסדרת השותף
    if (f.len[ps] >= 4) {
      const sp = hcp + shortPts(f, ps);
      const pMin = levelOf(pLast.c) === 1 ? 6 : 10;
      const gameNeed = need(gameLevel(ps), ps);
      if (sp + pMin + 2 >= gameNeed) return pickLegal(A, [bid(gameLevel(ps), ps)]);
      if (sp >= 16) return pickLegal(A, [bid(cheapest(lastC, ps) + 1, ps)]);
      return pickLegal(A, [bid(cheapest(lastC, ps), ps)]);
    }
  }
  // ללא שליט מאוזן
  if (f.bal && ps !== NT) {
    if (hcp <= 14 && levelOf(pLast.c) === 1 && A.isLegal(bid(1, NT))) return bid(1, NT);
    if (hcp >= 18 && hcp <= 19) return pickLegal(A, [levelOf(pLast.c) === 1 ? bid(2, NT) : bid(3, NT)]);
    if (levelOf(pLast.c) === 2 && hcp <= 14) return pickLegal(A, [bid(2, NT)]);
  }
  // סדרה שנייה
  const second = [S, H, D, C].filter((s) => s !== os && s !== ps && f.len[s] >= 4).sort((a, b) => f.len[b] - f.len[a] || b - a);
  for (const s of second) {
    const lvl = cheapest(lastC, s);
    const reverse = lvl === 2 && s > os;
    if (lvl === 1 || (lvl === 2 && (!reverse || pts >= 17))) {
      if (f.len[os] >= 6 && f.len[s] === 4) break;
      return bid(lvl, s);
    }
  }
  // חזרה על הסדרה
  if (f.len[os] >= 6) {
    const lvl = cheapest(lastC, os);
    if (pts >= 16 && lvl <= 2) return bid(lvl + 1, os);
    return bid(lvl, os);
  }
  if (f.bal || f.len[os] <= 5) {
    const ntl = cheapest(lastC, NT);
    if (ntl <= 2 && hcp <= 15) return bid(ntl, NT);
  }
  return bid(cheapest(lastC, os), os);
}

function afterStayman(ctx) {
  const { f, sit, A } = ctx;
  const ol = levelOf(sit.opening.call);
  const ans = sit.partnerCalls[sit.partnerCalls.length - 1];
  if (!ans || !isBid(ans.c) || sit.lastBid.seat !== partnerOf(ctx.seat)) return generic(ctx);
  const hcp = f.hcp + f.adj;
  const as = strainOf(ans.c);
  const game = ol === 1 ? hcp >= 10 : hcp >= 4;
  if ((as === H || as === S) && f.len[as] >= 4) return game ? bid(4, as) : bid(3, as);
  if (as === H && f.len[S] >= 4 && !game) return pickLegal(A, [bid(2, NT)]);
  if (hcp >= (ol === 1 ? 16 : 11)) return pickLegal(A, [bid(4, NT)]);
  return game ? pickLegal(A, [bid(3, NT)]) : pickLegal(A, [bid(2, NT), PASS]);
}

// ---------- המשך כללי ----------
function generic(ctx) {
  const { f, sit, A, P, meta, seat } = ctx;
  const lastC = sit.lastBid.call;
  const theirSuits = new Set(sit.theirBids.map((b) => strainOf(b.call)).filter((s) => s !== NT));
  const ourLastSeat = sit.ourBids.length ? sit.ourBids[sit.ourBids.length - 1].seat : null;
  const contractOurs = sideOf(sit.lastBid.seat) === sideOf(seat);
  const pEst = est(P) + (P.hi < 37 ? 0.5 : 0);

  // בחירת סדרה/ללא שליט
  let strain = null, fitLen = 0;
  for (const s of [S, H, D, C]) {
    const t = f.len[s] + P.len[s];
    const score = t + (isMajor(s) ? 0.6 : 0);
    if (t >= 8 && score > fitLen + (strain !== null && isMajor(strain) ? 0.6 : 0)) { strain = s; fitLen = t; }
  }
  const stoppersOk = [...theirSuits].every((s) => stopper(f, s) || P.len[s] >= 4);
  const ntOk = stoppersOk && (f.bal || P.bal || (f.len.every((l) => l >= 2)));
  let pts;
  if (strain !== null) {
    pts = f.hcp + f.adj + (P.len[strain] >= 4 && f.len[strain] >= 3 ? shortPts(f, strain) : lengthPts(f));
    // מיינור: אם יש עצירות ומאוזן, לשקול 3NT
    if (!isMajor(strain) && ntOk && f.hcp + pEst >= 25 && f.hcp + pEst < 30) { strain = NT; }
  } else if (ntOk) {
    strain = NT; pts = f.hcp + f.adj + (f.sorted[0] >= 5 ? 1 : 0);
  } else {
    // סדרה ארוכה שלי
    const own = [S, H, D, C].filter((s) => f.len[s] >= 6 && !theirSuits.has(s)).sort((a, b) => f.len[b] - f.len[a])[0];
    if (own !== undefined) { strain = own; pts = f.hcp + f.adj + lengthPts(f); }
    else {
      // חיפוש: סדרה חדשה של 4+ אם השותף חייב אותנו
      const forcedNow = P.forcing && contractOurs && sit.lastBid.seat === partnerOf(seat);
      const explore = [S, H, D, C].filter((s) => f.len[s] >= 4 && !theirSuits.has(s) && !sit.ourBids.some((b) => strainOf(b.call) === s));
      if ((forcedNow || f.hcp + pEst >= 24) && explore.length) {
        const s = explore[0];
        const c = bid(cheapest(lastC, s), s);
        if (levelOf(c) <= 3) return c;
      }
      const partnerSuit = [S, H, D, C].filter((s) => P.len[s] >= 5).sort((a, b) => P.len[b] - P.len[a])[0];
      if (forcedNow && partnerSuit !== undefined) return pickLegal(A, [bid(cheapest(lastC, partnerSuit), partnerSuit)]);
      if (forcedNow) return pickLegal(A, [bid(cheapest(lastC, NT), NT), bid(cheapest(lastC, f.sorted.indexOf(f.sorted[0])), 0)]);
      return maybeDouble(ctx, contractOurs);
    }
  }

  let combined = pts + pEst;
  const gf = meta.gameForce[sideOf(seat)];
  const gL = gameLevel(strain);
  if (gf) combined = Math.max(combined, need(gL, strain));

  // סלאם
  if (strain !== NT && combined >= 33 && !meta.blackwood && lastC < bid(4, NT) && fitLen >= 8) return bid(4, NT);
  let target = 0;
  for (let L = 1; L <= 7; L++) if (need(L, strain) <= combined + 0.5) target = L;
  if (strain === NT && target === 5) target = 4;
  // סלאם בסדרה רק דרך בלאקווד
  if (strain !== NT && target >= 6 && !(meta.blackwood && meta.blackwood.asker === seat)) target = lastC < bid(4, NT) ? target : Math.min(target, 5);
  if (strain !== NT && !isMajor(strain) && target === 4 && combined < 28) target = 3;
  // הזמנה
  if (target < gL && combined >= need(gL, strain) - 2 && P.hi - P.lo > 2 && !contractOurs) target = Math.max(target, gL - 1);

  const minL = cheapest(lastC, strain);
  const ourLastSame = contractOurs && strainOf(lastC) === strain;
  if (ourLastSame && levelOf(lastC) >= target) return maybeDouble(ctx, true);
  if (minL <= target) {
    // אם השותף כבר בחוזה שלנו באותה סדרה - לקפוץ ישר לגובה המטרה
    const lvl = target >= gL ? Math.max(minL, gL) : (target > minL && (ourLastSame || fitLen >= 8 || strain === NT) ? target : minL);
    if (lvl >= 6 && strain !== NT && !meta.blackwood && fitLen >= 8 && lastC < bid(4, NT)) return bid(4, NT);
    return bid(Math.min(lvl, 7), strain);
  }
  // תחרות לפי חוק הלקיחות הכולל
  if (!contractOurs && strain !== NT && fitLen >= 8) {
    const lawLevel = fitLen - 6 - (ctx.vul[sideOf(seat)] && !ctx.vul[1 - sideOf(seat)] ? 1 : 0);
    if (minL <= Math.min(lawLevel, 3) && levelOf(lastC) <= 3) return bid(minL, strain);
  }
  // חובה להמשיך אחרי הכרזה מחייבת של השותף
  if (P.forcing && sit.lastBid.seat === partnerOf(seat) && minL <= 3) return bid(minL, strain);
  if (gf && contractOurs && levelOf(lastC) < gL && !(strainOf(lastC) === NT && levelOf(lastC) >= 3)) return bid(Math.max(minL, gL), strain);
  void ourLastSeat;
  return maybeDouble(ctx, contractOurs);
}

function maybeDouble(ctx, contractOurs) {
  const { f, sit, A, P } = ctx;
  if (contractOurs || !A.isLegal(DOUBLE)) return PASS;
  const lc = sit.lastBid.call, L = levelOf(lc), st = strainOf(lc);
  const ourHcp = f.hcp + est(P);
  const trumpStack = st !== NT && f.len[st] >= 4 && topHonors(f, st, 4) >= 2;
  if (L >= 2 && ourHcp >= 23 && sit.ourBids.length) return DOUBLE;
  if (L >= 3 && trumpStack && f.hcp >= 10) return DOUBLE;
  if (st === NT && L >= 1 && f.hcp >= 15 && sit.partnerBids.length) return DOUBLE;
  return PASS;
}
