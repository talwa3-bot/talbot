// סימולציה: בוטים מכריזים על חלוקות אקראיות, והפותר בודק את תוצאת החוזה (דאבל דאמי).
import fs from 'fs';
import { initSync, solve_contract } from '../vendor/bridge-solver/bridge_solver_wasm.js';
import { dealBoard, boardInfo, SUIT_LETTER, rankLabel, suitOf, rankOf } from '../src/engine/cards.js';
import { toPbn } from '../src/engine/cards.js';
import { Auction, callText, contractText } from '../src/engine/bidding.js';
import { chooseCall } from '../src/ai/bid-ai.js';
import { nsScore } from '../src/engine/scoring.js';
initSync({ module: fs.readFileSync(new URL('../vendor/bridge-solver/bridge_solver_wasm_bg.wasm', import.meta.url)) });

const pbn = toPbn;
const N = +(process.argv[2] || 300), verbose = process.argv[3] === 'v';
let made = 0, played = 0, passOut = 0, games = 0, slams = 0, levels = 0, ddPar = 0, errors = 0;
const strainL = ['C', 'D', 'H', 'S', 'N'], seatL = 'NESW';
for (let b = 1; b <= N; b++) {
  const hands = dealBoard(777, b), bi = boardInfo(b);
  const A = new Auction(bi.dealer);
  let guard = 0;
  while (!A.isComplete() && guard++ < 60) {
    let c;
    try { c = chooseCall(hands[A.turn], A.calls, A.dealer, bi.vul, { debug: true }); }
    catch (e) { errors++; if (errors < 4) console.log('ERR', e.stack.split('\n').slice(0, 3).join(' | ')); c = 0; }
    if (!A.isLegal(c)) c = 0;
    A.add(c);
  }
  const ct = A.contract();
  if (!ct) { passOut++; if (verbose) console.log(b, 'passout', A.calls.map(callText).join(' ')); continue; }
  const ns = solve_contract(pbn(hands), strainL[ct.strain], seatL[(ct.declarer + 1) % 4]);
  const tricks = ct.declarer % 2 === 0 ? ns : 13 - ns;
  played++; levels += ct.level;
  if (tricks >= ct.level + 6) made++;
  if ((ct.strain === 4 && ct.level >= 3) || (ct.strain >= 2 && ct.level >= 4) || ct.level >= 5) games++;
  if (ct.level >= 6) slams++;
  if (verbose) console.log(b, seatL[A.dealer], A.calls.map(callText).join(' '), '=>', contractText(ct), seatL[ct.declarer], 'tricks', tricks, nsScore(ct, tricks, bi.vul));
}
console.log({ N, errors, passOut, played, makeRate: (made / played).toFixed(3), gameRate: (games / played).toFixed(3), slams, avgLevel: (levels / played).toFixed(2) });
