// ניקוד דופליקייט. מחזיר ניקוד מנקודת מבט המכריז (שלילי אם נפל).
import { NT } from './cards.js';

const trickValue = (strain) => (strain === NT ? 30 : strain >= 2 ? 30 : 20);

export function contractScore(contract, tricksTaken, vulnerable) {
  const { level, strain, doubled } = contract;
  const need = 6 + level;
  const mult = doubled === 2 ? 4 : doubled === 1 ? 2 : 1;

  if (tricksTaken < need) {
    const down = need - tricksTaken;
    let pen = 0;
    if (doubled === 0) {
      pen = down * (vulnerable ? 100 : 50);
    } else {
      for (let i = 1; i <= down; i++) {
        if (vulnerable) pen += i === 1 ? 200 : 300;
        else pen += i === 1 ? 100 : i <= 3 ? 200 : 300;
      }
      if (doubled === 2) pen *= 2;
    }
    return -pen;
  }

  const over = tricksTaken - need;
  let base = level * trickValue(strain) + (strain === NT ? 10 : 0);
  base *= mult;
  let score = base;
  score += base >= 100 ? (vulnerable ? 500 : 300) : 50;
  if (level === 6) score += vulnerable ? 750 : 500;
  if (level === 7) score += vulnerable ? 1500 : 1000;
  if (doubled === 1) score += 50;
  if (doubled === 2) score += 100;
  if (doubled === 0) score += over * trickValue(strain);
  else score += over * (vulnerable ? 200 : 100) * (doubled === 2 ? 2 : 1);
  return score;
}

// ניקוד מנקודת מבט צפון-דרום
export function nsScore(contract, tricksTaken, vulFlags) {
  if (!contract) return 0;
  const declSide = contract.declarer % 2;
  const s = contractScore(contract, tricksTaken, vulFlags[declSide]);
  return declSide === 0 ? s : -s;
}
