// חלוקה אחת: מכרז ומשחק, עם שמירה ושחזור.
import { dealBoard, boardInfo, sideOf, partnerOf } from '../engine/cards.js';
import { Auction } from '../engine/bidding.js';
import { Play } from '../engine/play.js';
import { nsScore } from '../engine/scoring.js';
import { interpret } from '../ai/bid-ai.js';

/** @typedef {{boardNo:number, seed:number, calls:number[], plays:number[]}} BoardSnapshot */

export class BoardGame {
  /**
   * @param {{boardNo:number, seed:number, humanSeat?:number, calls?:number[], plays?:number[]}} o
   */
  constructor({ boardNo, seed, humanSeat = 2, calls = [], plays = [] }) {
    this.boardNo = boardNo;
    this.seed = seed;
    this.humanSeat = humanSeat;
    this.info = boardInfo(boardNo);
    this.hands = dealBoard(seed, boardNo);
    this.auction = new Auction(this.info.dealer);
    /** @type {Play|null} */
    this.play = null;
    /** @type {number[]} */
    this.plays = [];
    for (const c of calls) this.addCall(c);
    for (const p of plays) this.addCard(p);
  }
  get phase() {
    if (!this.auction.isComplete()) return 'bidding';
    if (!this.play || this.play.isDone()) return 'done';
    return 'playing';
  }
  get contract() { return this.auction.isComplete() ? this.auction.contract() : null; }

  /** מי צריך לפעול עכשיו, ומי שולט בו (הכרוז שולט בדומם) */
  actor() {
    if (this.phase === 'bidding') {
      const seat = this.auction.turn;
      return { seat, controller: seat, human: seat === this.humanSeat };
    }
    if (this.phase === 'playing') {
      const seat = this.play.turn;
      const controller = seat === this.play.dummy ? this.play.declarer : seat;
      return { seat, controller, human: controller === this.humanSeat };
    }
    return null;
  }
  /** האם הדרום הוא הדומם (השותף משחק את שתי הידיים) */
  humanIsDummy() { return !!this.play && this.play.dummy === this.humanSeat; }

  /** @param {number} call */
  addCall(call) {
    this.auction.add(call);
    if (this.auction.isComplete()) {
      const ct = this.auction.contract();
      if (ct) this.play = new Play(this.hands, ct);
    }
  }
  /** @param {number} card */
  addCard(card) {
    if (!this.play) throw new Error('אין משחק');
    const r = this.play.play(card);
    this.plays.push(card);
    return r;
  }
  /** תצוגת מצב לבוט המשחק */
  playView() {
    const p = this.play;
    return {
      seat: p.turn, hands: p.hands, declarer: p.declarer, trump: p.trump,
      trick: p.trick, history: p.history, legal: p.legalCards(),
      info: interpret(this.auction.calls, this.auction.dealer).info,
    };
  }
  result() {
    const ct = this.contract;
    if (!ct) return { contract: null, tricks: 0, ns: 0 };
    const tricks = this.play.declarerTricks();
    return { contract: ct, tricks, ns: nsScore(ct, tricks, this.info.vul) };
  }
  /** @returns {BoardSnapshot} */
  snapshot() { return { boardNo: this.boardNo, seed: this.seed, calls: [...this.auction.calls], plays: [...this.plays] }; }
}
export { sideOf, partnerOf };
