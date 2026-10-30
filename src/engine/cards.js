// קלפים, מושבים, חלוקה ופגיעות.
// סדרות: 0=תלתן 1=יהלום 2=לב 3=עלה. קלף = מספר 0..51.
export const CLUBS = 0, DIAMONDS = 1, HEARTS = 2, SPADES = 3, NT = 4;
export const SUIT_SYMBOL = ['♣', '♦', '♥', '♠'];
export const SUIT_LETTER = ['C', 'D', 'H', 'S'];

export const card = (suit, rank) => suit * 13 + rank - 2;
export const suitOf = (c) => (c / 13) | 0;
export const rankOf = (c) => (c % 13) + 2;
export const rankLabel = (r) => ({ 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }[r] ?? String(r));
export const cardLabel = (c) => SUIT_SYMBOL[suitOf(c)] + rankLabel(rankOf(c));
export const hcpOfCard = (c) => Math.max(0, rankOf(c) - 10);
export const handHcp = (h) => h.reduce((a, c) => a + hcpOfCard(c), 0);

export function suitLengths(hand) {
  const l = [0, 0, 0, 0];
  for (const c of hand) l[suitOf(c)]++;
  return l;
}

// מושבים: 0=צפון 1=מזרח 2=דרום 3=מערב
export const N = 0, E = 1, S = 2, W = 3;
export const SEAT_NAME_HE = ['צפון', 'מזרח', 'דרום', 'מערב'];
export const partnerOf = (s) => (s + 2) % 4;
export const sideOf = (s) => s % 2; // 0 = צפון-דרום, 1 = מזרח-מערב

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function dealHands(rng) {
  const deck = Array.from({ length: 52 }, (_, i) => i);
  for (let i = 51; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return [0, 1, 2, 3].map((s) => deck.slice(s * 13, s * 13 + 13).sort((a, b) => a - b));
}

// סדר תצוגה: עלה, לב, תלתן, יהלום (שחור/אדום לסירוגין), מהגבוה לנמוך.
const DISPLAY_SUIT_ORDER = [3, 2, 0, 1];
export function sortForDisplay(hand, trump = null) {
  const order = trump !== null && trump !== NT && trump !== undefined
    ? [trump, ...DISPLAY_SUIT_ORDER.filter((s) => s !== trump)] : DISPLAY_SUIT_ORDER;
  return [...hand].sort((a, b) => {
    const sa = order.indexOf(suitOf(a)), sb = order.indexOf(suitOf(b));
    return sa !== sb ? sa - sb : rankOf(b) - rankOf(a);
  });
}

// מספר חלוקה (מ-1) -> מחלק ופגיעות, לפי הלוח הרשמי של 16 חלוקות.
const VUL_CYCLE = ['none', 'NS', 'EW', 'both', 'NS', 'EW', 'both', 'none',
  'EW', 'both', 'none', 'NS', 'both', 'none', 'NS', 'EW'];
export function boardInfo(boardNo) {
  const v = VUL_CYCLE[(boardNo - 1) % 16];
  return {
    dealer: (boardNo - 1) % 4,
    vul: [v === 'NS' || v === 'both', v === 'EW' || v === 'both'], // לפי צד: [צפון-דרום, מזרח-מערב]
    vulName: v,
  };
}

export function dealBoard(seed, boardNo) {
  const rng = mulberry32((seed * 7919 + boardNo * 104729) >>> 0);
  return dealHands(rng);
}

// פורמט PBN לפותר: "N:AKQ.JT9.876.5432 ..." (עלה.לב.יהלום.תלתן)
export function toPbn(hands) {
  return 'N:' + hands.map((h) => [3, 2, 1, 0].map((s) => h.filter((c) => suitOf(c) === s)
    .sort((a, b) => rankOf(b) - rankOf(a)).map((c) => (rankOf(c) === 10 ? 'T' : rankLabel(rankOf(c)))).join('')).join('.')).join(' ');
}
export const cardCode = (c) => SUIT_LETTER[suitOf(c)] + (rankOf(c) === 10 ? 'T' : rankLabel(rankOf(c)));
