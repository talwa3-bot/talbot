// מהלך המשחק: חוקיות קלפים, לקיחות וקביעת זוכה.
import { suitOf, rankOf, NT } from './cards.js';

export class Play {
  constructor(hands, contract, trickResults = null) {
    this.hands = hands.map((h) => [...h]);
    this.contract = contract;
    this.trump = contract.strain === NT ? null : contract.strain;
    this.declarer = contract.declarer;
    this.dummy = (contract.declarer + 2) % 4;
    this.leader = (contract.declarer + 1) % 4;
    this.trick = []; // [{seat, card}]
    this.history = []; // [{leader, plays, winner}]
    this.won = [0, 0]; // לקיחות לפי צד
    this.played = new Set();
  }
  get turn() { return (this.leader + this.trick.length) % 4; }
  isDone() { return this.history.length === 13; }
  dummyVisible() { return this.history.length > 0 || this.trick.length > 0; }
  get ledSuit() { return this.trick.length ? suitOf(this.trick[0].card) : null; }

  legalCards(seat = this.turn) {
    const hand = this.hands[seat];
    if (!this.trick.length) return [...hand];
    const led = this.ledSuit;
    const follow = hand.filter((c) => suitOf(c) === led);
    return follow.length ? follow : [...hand];
  }
  isLegal(card, seat = this.turn) { return this.legalCards(seat).includes(card); }

  winnerOf(plays) {
    const led = suitOf(plays[0].card);
    let best = plays[0];
    for (const p of plays.slice(1)) {
      const ps = suitOf(p.card), bs = suitOf(best.card);
      if (ps === bs) { if (rankOf(p.card) > rankOf(best.card)) best = p; }
      else if (this.trump !== null && ps === this.trump) best = p;
    }
    void led;
    return best.seat;
  }

  play(card) {
    const seat = this.turn;
    if (!this.isLegal(card, seat)) throw new Error('קלף לא חוקי');
    this.hands[seat] = this.hands[seat].filter((c) => c !== card);
    this.trick.push({ seat, card });
    this.played.add(card);
    if (this.trick.length === 4) {
      const winner = this.winnerOf(this.trick);
      this.history.push({ leader: this.leader, plays: this.trick, winner });
      this.won[winner % 2]++;
      this.leader = winner;
      this.trick = [];
      return { trickDone: true, winner };
    }
    return { trickDone: false };
  }
  declarerTricks() { return this.won[this.declarer % 2]; }
}
