import test from 'node:test';
import assert from 'node:assert/strict';
import { card, SPADES as S, HEARTS as H, CLUBS as C, DIAMONDS as D, NT, boardInfo, dealBoard } from '../src/engine/cards.js';
import { Auction, bid, PASS, DOUBLE, REDOUBLE } from '../src/engine/bidding.js';
import { contractScore } from '../src/engine/scoring.js';
import { Play } from '../src/engine/play.js';
import { matchpoints } from '../src/game/tournament.js';
import { BoardGame } from '../src/game/board.js';
import { chooseCall } from '../src/ai/bid-ai.js';
import { heuristic } from '../src/ai/play-ai.js';

test('פגיעות ומחלק לפי מספר חלוקה', () => {
  assert.deepEqual(boardInfo(1), { dealer: 0, vul: [false, false], vulName: 'none' });
  assert.deepEqual(boardInfo(2).vul, [true, false]);
  assert.deepEqual(boardInfo(7).vul, [true, true]);
  assert.equal(boardInfo(16).dealer, 3);
});

test('חלוקה: 52 קלפים שונים, 13 לכל יד, דטרמיניסטית', () => {
  const h = dealBoard(5, 3);
  assert.equal(new Set(h.flat()).size, 52);
  h.forEach((x) => assert.equal(x.length, 13));
  assert.deepEqual(h, dealBoard(5, 3));
});

test('חוקיות הכרזות: כפל, כפל חוזר, סיום', () => {
  const a = new Auction(0);
  assert.equal(a.isLegal(DOUBLE), false);
  a.add(bid(1, H));
  assert.equal(a.isLegal(bid(1, D)), false);
  assert.equal(a.isLegal(DOUBLE), true);
  a.add(DOUBLE);
  assert.equal(a.isLegal(REDOUBLE), true);
  a.add(PASS);
  assert.equal(a.isLegal(DOUBLE), false, 'אסור לכפול את השותף');
  a.add(PASS); a.add(PASS);
  assert.equal(a.isComplete(), true);
  assert.deepEqual(a.contract(), { level: 1, strain: H, declarer: 0, doubled: 1 });
});

test('המכריז הוא הראשון בצד שהכריז על הסדרה', () => {
  const a = new Auction(0, [bid(1, S), PASS, bid(2, S), PASS, bid(4, S), PASS, PASS, PASS]);
  assert.equal(a.contract().declarer, 0);
  assert.equal(new Auction(0, [PASS, PASS, PASS, PASS]).contract(), null);
});

test('ניקוד דופליקייט', () => {
  assert.equal(contractScore({ level: 4, strain: S, doubled: 0 }, 10, false), 420);
  assert.equal(contractScore({ level: 4, strain: S, doubled: 0 }, 11, true), 650);
  assert.equal(contractScore({ level: 3, strain: NT, doubled: 0 }, 9, false), 400);
  assert.equal(contractScore({ level: 1, strain: NT, doubled: 0 }, 8, false), 120);
  assert.equal(contractScore({ level: 2, strain: C, doubled: 0 }, 8, false), 90);
  assert.equal(contractScore({ level: 6, strain: H, doubled: 0 }, 12, true), 1430);
  assert.equal(contractScore({ level: 7, strain: NT, doubled: 0 }, 13, false), 1520);
  assert.equal(contractScore({ level: 2, strain: H, doubled: 1 }, 8, false), 470);
  assert.equal(contractScore({ level: 4, strain: S, doubled: 1 }, 7, false), -500);
  assert.equal(contractScore({ level: 4, strain: S, doubled: 1 }, 6, false), -800);
  assert.equal(contractScore({ level: 4, strain: S, doubled: 1 }, 7, true), -800);
  assert.equal(contractScore({ level: 3, strain: NT, doubled: 0 }, 7, true), -200);
  assert.equal(contractScore({ level: 1, strain: S, doubled: 2 }, 8, false), 720);
});

test('לקיחה: חובה ללכת אחרי סדרה, שליט מנצח', () => {
  const hands = [[card(H, 2), card(S, 3)], [card(H, 14), card(C, 4)], [card(D, 5), card(S, 9)], [card(H, 5), card(H, 6)]]
    .map((h) => [...h, ...Array(0)]);
  const p = new Play(hands, { level: 1, strain: S, declarer: 3, doubled: 0 });
  assert.equal(p.turn, 0);
  assert.deepEqual(p.legalCards(0).sort(), [card(H, 2), card(S, 3)].sort());
  p.play(card(H, 2));
  assert.equal(p.isLegal(card(C, 4), 1), false);
  p.play(card(H, 14));
  p.play(card(S, 9)); // חיתוך
  p.play(card(H, 5));
  assert.equal(p.history[0].winner, 2);
});

test('מאץ׳-פוינט כולל תיקו', () => {
  assert.deepEqual(matchpoints([420, 420, 50, -100]), [83.33333333333333, 83.33333333333333, 33.333333333333336, 0]);
});

test('חלוקה שלמה של בוטים: מכרז חוקי ומשחק עד הסוף, שחזור משמירה', () => {
  for (let b = 1; b <= 30; b++) {
    const g = new BoardGame({ boardNo: b, seed: 99, humanSeat: -1 });
    while (g.phase === 'bidding') g.addCall(chooseCall(g.hands[g.auction.turn], g.auction.calls, g.auction.dealer, g.info.vul));
    while (g.phase === 'playing') g.addCard(heuristic(g.playView()));
    assert.equal(g.phase, 'done');
    const copy = new BoardGame({ ...g.snapshot(), humanSeat: -1 });
    assert.deepEqual(copy.result(), g.result());
  }
});
