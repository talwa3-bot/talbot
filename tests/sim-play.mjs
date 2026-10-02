// סימולציית משחק מלא: בוטים מכריזים ומשחקים; משווים לתוצאה התאורטית (דאבל דאמי).
import fs from 'fs';
import { initSync, solve_contract, Analyzer } from '../vendor/bridge-solver/bridge_solver_wasm.js';
import { dealBoard, boardInfo, NT } from '../src/engine/cards.js';
import { toPbn } from '../src/engine/cards.js';
import { Auction, contractText } from '../src/engine/bidding.js';
import { Play } from '../src/engine/play.js';
import { chooseCall, interpret } from '../src/ai/bid-ai.js';
import { chooseCard } from '../src/ai/play-ai.js';
const pbn = toPbn;
initSync({ module: fs.readFileSync(new URL('../vendor/bridge-solver/bridge_solver_wasm_bg.wasm', import.meta.url)) });
const solver = new Analyzer();
const N = +(process.argv[2] || 6);
let diff = 0, maxMs = 0, totalMs = 0, moves = 0;
for (let b = 1; b <= N; b++) {
  const hands = dealBoard(4242, b), bi = boardInfo(b);
  const A = new Auction(bi.dealer);
  while (!A.isComplete()) A.add(chooseCall(hands[A.turn], A.calls, A.dealer, bi.vul));
  const ct = A.contract(); if (!ct) continue;
  const ns = solve_contract(pbn(hands), 'CDHSN'[ct.strain], 'NESW'[(ct.declarer + 1) % 4]);
  const dd = ct.declarer % 2 === 0 ? ns : 13 - ns;
  const info = interpret(A.calls, A.dealer).info;
  const P = new Play(hands, ct);
  while (!P.isDone()) {
    const t = Date.now();
    const c = chooseCard({ seat: P.turn, hands: P.hands, declarer: P.declarer, trump: P.trump, trick: P.trick,
      history: P.history, legal: P.legalCards(), info }, solver, { seed: b * 100 + P.history.length, maxSamples: (P.turn % 2 === P.declarer % 2) ? +(process.argv[3] || 20) : 24, timeMs: (P.turn % 2 === P.declarer % 2) ? +(process.argv[4] || 800) : 1400 });
    const ms = Date.now() - t; maxMs = Math.max(maxMs, ms); totalMs += ms; moves++;
    P.play(c);
  }
  diff += P.declarerTricks() - dd;
  console.log(b, contractText(ct), 'NESW'[ct.declarer], 'played', P.declarerTricks(), 'dd', dd);
}
console.log({ avgDeclMinusDD: (diff / N).toFixed(2), avgMs: (totalMs / moves).toFixed(0), maxMs });
