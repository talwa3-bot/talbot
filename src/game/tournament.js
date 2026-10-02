// הטורניר: זוגות מכל העולם, סבבים של שתי חלוקות, ניקוד לפי אחוזי מאץ'-פוינט.
import { mulberry32 } from '../engine/cards.js';

/** @typedef {{names:string, country:string, flag:string, rating:number}} Pair */

/** @type {Pair[]} */
export const WORLD_PAIRS = [
  { names: 'מריה ופבלו', country: 'ספרד', flag: '🇪🇸', rating: 1712 },
  { names: 'ג׳ון ומרגרט', country: 'אנגליה', flag: '🇬🇧', rating: 1688 },
  { names: 'פייר ואמלי', country: 'צרפת', flag: '🇫🇷', rating: 1740 },
  { names: 'האנס וגרטה', country: 'גרמניה', flag: '🇩🇪', rating: 1655 },
  { names: 'ג׳וזפה ולוצ׳יה', country: 'איטליה', flag: '🇮🇹', rating: 1801 },
  { names: 'אינגריד ולארס', country: 'שוודיה', flag: '🇸🇪', rating: 1764 },
  { names: 'יאן ומרייקה', country: 'הולנד', flag: '🇳🇱', rating: 1779 },
  { names: 'רוברט ולינדה', country: 'ארצות הברית', flag: '🇺🇸', rating: 1695 },
  { names: 'קרוליינה ופדרו', country: 'ברזיל', flag: '🇧🇷', rating: 1630 },
  { names: 'יאנוש ואווה', country: 'פולין', flag: '🇵🇱', rating: 1748 },
  { names: 'ג׳ורג׳ והלן', country: 'אוסטרליה', flag: '🇦🇺', rating: 1667 },
  { names: 'דוד ושרה', country: 'ישראל', flag: '🇮🇱', rating: 1722 },
  { names: 'ניקוס ואלני', country: 'יוון', flag: '🇬🇷', rating: 1610 },
  { names: 'אוליביה וליאם', country: 'קנדה', flag: '🇨🇦', rating: 1684 },
  { names: 'טקשי ויוקו', country: 'יפן', flag: '🇯🇵', rating: 1702 },
  { names: 'אנה ומיגל', country: 'ארגנטינה', flag: '🇦🇷', rating: 1735 },
  { names: 'פטר וקלרה', country: 'צ׳כיה', flag: '🇨🇿', rating: 1641 },
  { names: 'סורן ומטה', country: 'דנמרק', flag: '🇩🇰', rating: 1726 },
];

export const PARTNER = { name: 'רות', flag: '🇮🇱' };

/**
 * רמות היריבים. משפיעות על עומק החשיבה של הבוטים בקלפים ועל חוזק השדה בשולחנות האחרים.
 * @typedef {'club'|'expert'|'champion'} Level
 */
export const LEVELS = {
  club: { name: 'מועדון', desc: 'יריבים טובים שטועים לפעמים', samples: 6, timeMs: 400, blunder: 0.25, fieldSpread: 4, fieldDown: 0.3, fieldUp: 0.05, rating: -250 },
  expert: { name: 'מתקדמים', desc: 'יריבים חזקים', samples: 24, timeMs: 1400, blunder: 0, fieldSpread: 3, fieldDown: 0.12, fieldUp: 0.07, rating: 0 },
  champion: { name: 'אלופים', desc: 'הכי קשה: יריבים ושדה ברמת אליפות', samples: 48, timeMs: 2600, blunder: 0, fieldSpread: 1.6, fieldDown: 0.05, fieldUp: 0.03, rating: 250 },
};
/** @param {string} l */
export const levelConfig = (l) => LEVELS[l] || LEVELS.expert;

/**
 * @param {{seed?:number, boards?:number, playerName?:string, level?:string}} o
 */
export function createTournament({ seed = (Date.now() % 1e9) | 0, boards = 8, playerName = 'סבתא', level = 'champion' } = {}) {
  const rng = mulberry32(seed);
  const pool = [...WORLD_PAIRS];
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const rounds = Math.ceil(boards / 2);
  return {
    seed, boards, playerName, level,
    startBoard: 1 + Math.floor(rng() * 16),
    opponents: pool.slice(0, rounds),            // יריבים מזרח-מערב בכל סבב
    field: pool.slice(rounds, rounds + 9),       // זוגות צפון-דרום אחרים בשדה
    /** @type {any[]} */ results: [],
    index: 0,
    /** @type {{calls:number[], plays:number[]}|null} */ live: null,
  };
}
export const boardNoAt = (t, i) => ((t.startBoard + i - 1) % 32) + 1;
export const opponentsAt = (t, i) => t.opponents[Math.floor(i / 2) % t.opponents.length];

/** מאץ'-פוינט באחוזים לכל תוצאה במערך (מנקודת מבט צפון-דרום) */
export function matchpoints(scores) {
  const n = scores.length;
  return scores.map((s, i) => {
    let mp = 0;
    scores.forEach((o, j) => { if (j !== i) mp += s > o ? 1 : s === o ? 0.5 : 0; });
    return n > 1 ? (100 * mp) / (n - 1) : 50;
  });
}

/** טבלת דירוג: אנחנו + זוגות השדה, לפי ממוצע אחוזים */
export function standings(t) {
  const rows = [{ me: true, names: t.playerName + ' ו' + PARTNER.name, flag: PARTNER.flag, country: 'ישראל', total: 0 },
    ...t.field.map((p) => ({ me: false, names: p.names, flag: p.flag, country: p.country, total: 0 }))];
  for (const r of t.results) {
    const pcts = matchpoints([r.ns, ...r.field.map((f) => f.ns)]);
    pcts.forEach((p, i) => { rows[i].total += p; });
  }
  const n = Math.max(1, t.results.length);
  return rows.map((r) => ({ ...r, pct: t.results.length ? r.total / n : 50 }))
    .sort((a, b) => b.pct - a.pct || (a.me ? -1 : 1));
}
