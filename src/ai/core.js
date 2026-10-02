// פעולות הבוטים שדורשות את הפותר: בחירת קלף, תוצאות השדה, בדיקת "תביעה".
import { dealBoard, boardInfo, toPbn, mulberry32 } from '../engine/cards.js';
import { Auction } from '../engine/bidding.js';
import { Play } from '../engine/play.js';
import { nsScore } from '../engine/scoring.js';
import { chooseCall, interpret } from './bid-ai.js';
import { chooseCard, heuristic } from './play-ai.js';
import { levelConfig } from '../game/tournament.js';

const STRAIN_L = 'CDHSN', SEAT_L = 'NESW';

/** מספר הלקיחות של צפון-דרום במשחק מושלם */
function ddNs(solve, hands, strain, leader) {
  return solve(toPbn(hands), STRAIN_L[strain], SEAT_L[leader]);
}

/**
 * תוצאות השולחנות האחרים באותה חלוקה. בכל שולחן הבוטים מעריכים קצת אחרת.
 * @param {{solve:Function|null, seed:number, boardNo:number, tables:number, level?:string}} o
 */
export function fieldResults({ solve, seed, boardNo, tables, level }) {
  const L = levelConfig(level);
  const hands = dealBoard(seed, boardNo), bi = boardInfo(boardNo);
  const out = [];
  for (let t = 0; t < tables; t++) {
    const rng = mulberry32(seed * 31 + boardNo * 977 + t * 7);
    const adj = [0, 1, 2, 3].map(() => Math.round((rng() - 0.5) * L.fieldSpread)); // סטייה בהערכת היד, לפי הרמה
    const A = new Auction(bi.dealer);
    while (!A.isComplete()) A.add(chooseCall(hands[A.turn], A.calls, A.dealer, bi.vul, { adjust: adj[A.turn] }));
    const ct = A.contract();
    if (!ct) { out.push({ contract: null, tricks: 0, ns: 0, calls: A.calls }); continue; }
    let tricks;
    if (solve) {
      const ns = ddNs(solve, hands, ct.strain, (ct.declarer + 1) % 4);
      tricks = ct.declarer % 2 === 0 ? ns : 13 - ns;
      // קצת רעש אנושי: לפעמים לקיחה פחות/יותר
      const r = rng();
      if (r < L.fieldDown && tricks > 0) tricks--; else if (r > 1 - L.fieldUp && tricks < 13) tricks++;
    } else {
      const P = new Play(hands, ct);
      const info = interpret(A.calls, A.dealer).info;
      while (!P.isDone()) P.play(heuristic({ seat: P.turn, hands: P.hands, declarer: P.declarer, trump: P.trump, trick: P.trick, history: P.history, legal: P.legalCards(), info }));
      tricks = P.declarerTricks();
    }
    out.push({ contract: ct, tricks, ns: nsScore(ct, tricks, bi.vul), calls: A.calls });
  }
  return out;
}

/** האם הכרוז יכול לקחת את כל הלקיחות שנותרו (בדיקת תביעה, בתחילת לקיחה) */
export function claimAll({ solve, hands, trump, declarer, leader }) {
  if (!solve) return false;
  const remaining = hands[0].length;
  const ns = solve(toPbn(hands), trump === null ? 'N' : STRAIN_L[trump], SEAT_L[leader]);
  const declTricksLeft = declarer % 2 === 0 ? ns : remaining - ns;
  return declTricksLeft === remaining;
}

export { chooseCard, chooseCall };
