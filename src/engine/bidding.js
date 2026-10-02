// הכרזות: קידוד, חוקיות ופענוח החוזה.
import { sideOf, NT } from './cards.js';

export const PASS = 0, DOUBLE = 1, REDOUBLE = 2;
export const bid = (level, strain) => 3 + (level - 1) * 5 + strain;
export const isBid = (c) => c >= 3;
export const levelOf = (c) => (((c - 3) / 5) | 0) + 1;
export const strainOf = (c) => (c - 3) % 5;

export class Auction {
  constructor(dealer, calls = []) {
    this.dealer = dealer;
    this.calls = [];
    for (const c of calls) this.add(c);
  }
  get turn() { return (this.dealer + this.calls.length) % 4; }
  seatOf(i) { return (this.dealer + i) % 4; }
  lastBidIndex() {
    for (let i = this.calls.length - 1; i >= 0; i--) if (isBid(this.calls[i])) return i;
    return -1;
  }
  isComplete() {
    const n = this.calls.length;
    return n >= 4 && this.calls[n - 1] === PASS && this.calls[n - 2] === PASS && this.calls[n - 3] === PASS;
  }
  isLegal(call) {
    if (this.isComplete()) return false;
    if (call === PASS) return true;
    const L = this.lastBidIndex();
    if (isBid(call)) return L < 0 || call > this.calls[L];
    if (L < 0) return false;
    const me = this.turn;
    const after = this.calls.slice(L + 1);
    const bidderSide = sideOf(this.seatOf(L));
    if (call === DOUBLE) {
      return sideOf(me) !== bidderSide && after.every((c) => c === PASS);
    }
    if (call === REDOUBLE) {
      const xi = after.indexOf(DOUBLE);
      if (xi < 0 || after.includes(REDOUBLE)) return false;
      return sideOf(this.seatOf(L + 1 + xi)) !== sideOf(me);
    }
    return false;
  }
  legalCalls() {
    const out = [];
    for (let c = 0; c < 38; c++) if (this.isLegal(c)) out.push(c);
    return out;
  }
  add(call) {
    if (!this.isLegal(call)) throw new Error('הכרזה לא חוקית: ' + call);
    this.calls.push(call);
  }
  contract() {
    const L = this.lastBidIndex();
    if (L < 0) return null;
    const call = this.calls[L];
    const strain = strainOf(call);
    const bidderSide = sideOf(this.seatOf(L));
    let declarer = null;
    for (let i = 0; i <= L; i++) {
      if (isBid(this.calls[i]) && strainOf(this.calls[i]) === strain && sideOf(this.seatOf(i)) === bidderSide) {
        declarer = this.seatOf(i);
        break;
      }
    }
    const after = this.calls.slice(L + 1);
    const doubled = after.includes(REDOUBLE) ? 2 : after.includes(DOUBLE) ? 1 : 0;
    return { level: levelOf(call), strain, declarer, doubled };
  }
}

export const STRAIN_NAME_HE = ['תלתן', 'יהלום', 'לב', 'עלה', 'ללא שליט'];
export const STRAIN_SYMBOL = ['♣', '♦', '♥', '♠', 'NT'];
export function callText(c) {
  if (c === PASS) return 'פס';
  if (c === DOUBLE) return 'כפל';
  if (c === REDOUBLE) return 'כפל חוזר';
  return levelOf(c) + STRAIN_SYMBOL[strainOf(c)];
}
export function contractText(ct) {
  if (!ct) return 'כולם פס';
  return ct.level + STRAIN_SYMBOL[ct.strain] + (ct.doubled === 2 ? ' XX' : ct.doubled === 1 ? ' X' : '');
}
export { NT };
