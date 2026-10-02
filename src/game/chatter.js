// השיחה ליד השולחן: מה הדמויות אומרות, שואלות ועונות. עברית, חם ואנושי.
// כלל יסוד: מי ששואל ישירות אם הדמויות אמיתיות - מקבל תשובה כנה.
import { suitOf, rankOf, rankLabel, SUIT_SYMBOL, handHcp, suitLengths } from '../engine/cards.js';
import { PASS, DOUBLE, REDOUBLE, isBid, levelOf, strainOf, STRAIN_SYMBOL } from '../engine/bidding.js';

/** @typedef {{seat:number, text:string, replies?:string[], qkey?:string}} Line */
/** @typedef {{me:string, names:{name:string, flag:string, country?:string}[], rng:()=>number}} ChatCtx */

const pick = (arr, rng) => arr[Math.floor(rng() * arr.length) % arr.length];
const fill = (s, ctx, extra = {}) => s.replace(/\{(\w+)\}/g, (_, k) => (k === 'me' ? ctx.me : extra[k] ?? ''));

const SUIT_NAME = ['תלתנים', 'יהלומים', 'לבבות', 'עלים'];
export const callWords = (c) => (c === PASS ? 'פס' : c === DOUBLE ? 'כפל' : c === REDOUBLE ? 'כפל חוזר' : levelOf(c) + STRAIN_SYMBOL[strainOf(c)]);
const cardWords = (c) => rankLabel(rankOf(c)) + SUIT_SYMBOL[suitOf(c)];

// ---------- שאלות של שיחת חולין, ותשובות מוכנות לנסיה ----------
export const QUESTIONS = {
  howAreYou: {
    q: ['מה שלומך היום, {me}?', 'איך את מרגישה היום, {me}?', 'מה נשמע אצלך, {me}?'],
    replies: ['טוב, תודה! 😊', 'ככה ככה', 'מצוין!'],
    answers: [['איזה יופי לשמוע! 😊', 'שמחה לשמוע!'], ['שיהיה יום טוב יותר. ברידג׳ טוב משפר את מצב הרוח 🤞', 'אני מחזיקה לך אצבעות שיהיה יותר טוב ❤️'], ['נהדר! רואים את זה במשחק 😄', 'מעולה, תמשיכי ככה!']],
  },
  years: {
    q: ['כמה שנים את משחקת ברידג׳?', 'מאיפה למדת לשחק כל כך טוב?'],
    replies: ['הרבה שנים!', 'מאז שהייתי צעירה', 'סוד מקצועי 😉'],
    answers: [['רואים! יש לך יד של אלופה', 'זה מורגש בכל הכרזה'], ['איזה יופי, אהבה לכל החיים ❤️', 'אז את בטח מכירה כל תרגיל'], ['חחח, טוב שאת שומרת עליו 😄', 'הבנתי, לא מגלים את הסודות 😉']],
  },
  family: {
    q: ['יש לך נכדים, {me}?', 'יש לך משפחה גדולה?'],
    replies: ['כן, ואני גאה בהם ❤️', 'משפחה גדולה, ברוך השם', 'משפחה קטנה ומקסימה'],
    answers: [['איזה כיף! בטח הם גאים בסבתא שלהם', 'נחת אמיתית ❤️'], ['שיהיו בריאים כולם!', 'כמה שמחה בבית'], ['העיקר שאוהבים ❤️', 'קטנה וחמה, הכי טוב']],
  },
  weather: {
    q: ['איך מזג האוויר אצלכם בישראל?', 'חם אצלכם עכשיו?'],
    replies: ['נעים מאוד ☀️', 'חם!', 'קצת קר'],
    answers: [['מקנאה! אצלנו קצת אפור 🌥️', 'נשמע מושלם לשחק ברידג׳'], ['תשתי הרבה מים! 💧', 'אצלנו דווקא קריר'], ['אז כוס תה חמה ליד המשחק ☕', 'תתכרבלי טוב!']],
  },
  cooking: {
    q: ['מה את אוהבת לבשל?', 'מה בישלת היום?'],
    replies: ['מרק עוף 🍲', 'עוגה 🍰', 'היום לא בישלתי'],
    answers: [['מרק עוף של סבתא, אין דבר כזה טוב! 🍲', 'מרפא הכול'], ['יאמי! הייתי באה לטעום 🍰', 'איזו עוגה? אני אוהבת שמרים'], ['מגיע לך יום חופש 😊', 'היום יום של ברידג׳ ולא של מטבח']],
  },
  music: {
    q: ['איזו מוזיקה את אוהבת?', 'את אוהבת לשמוע מוזיקה תוך כדי משחק?'],
    replies: ['שירים ישנים 🎶', 'מוזיקה קלאסית', 'שקט, אני מתרכזת'],
    answers: [['השירים של פעם הכי יפים 🎶'], ['גם אני! מוצרט מתאים לברידג׳'], ['צודקת, ברידג׳ צריך ריכוז 😄']],
  },
};
const QKEYS = Object.keys(QUESTIONS);

/** שאלת חולין של אחת הדמויות. מדלגים על שאלות שכבר נשאלו. */
export function smallTalk(ctx, asked = []) {
  const left = QKEYS.filter((k) => !asked.includes(k));
  const key = pick(left.length ? left : QKEYS, ctx.rng);
  const seat = pick([0, 1, 3], ctx.rng);
  return { seat, text: fill(pick(QUESTIONS[key].q, ctx.rng), ctx), replies: QUESTIONS[key].replies, qkey: key };
}

/** תגובה לתשובה המוכנה שנסיה בחרה */
export function answerReply(qkey, index, ctx, seat) {
  const q = QUESTIONS[qkey];
  if (!q) return null;
  return { seat, text: fill(pick(q.answers[index] || q.answers[0], ctx.rng), ctx) };
}

// ---------- תגובה לטקסט חופשי (כשאין שיחה חכמה) ----------
const HONEST = /(רובוט|רובוטים|בוט|אמיתי|אמיתית|אמיתיים|מחשב|מכונה|תוכנה|בינה מלאכותית|AI)/i;
export function honestAnswer(ctx, seat) {
  return {
    seat,
    text: fill(pick([
      'אני אגיד לך בכנות, {me}: אני דמות במשחק, תוכנה שמשחקת ברידג׳ ומדברת איתך. אבל השיחה איתך באמת משמחת אותי 😊',
      'בכנות? אני דמות ממוחשבת במשחק. את, לעומת זאת, שחקנית אמיתית ומצוינת ❤️',
    ], ctx.rng), ctx),
  };
}

/** @param {string} text @param {ChatCtx} ctx @param {number} seat */
export function freeReply(text, ctx, seat) {
  const t = text.trim();
  if (HONEST.test(t)) return honestAnswer(ctx, seat);
  /** @type {[RegExp, string[]][]} */
  const rules = [
    [/(שלום|היי|הי|בוקר טוב|ערב טוב|צהריים טובים)/, ['שלום {me}! איזה כיף שאת כאן 😊', 'שלום שלום! שמחים לשחק איתך']],
    [/(מה שלומך|מה נשמע|מה שלומכם|איך אתם)/, ['תודה, הכול טוב! ואצלך?', 'מצוין, במיוחד כשמשחקים מולך 😄']],
    [/(תודה|תודה רבה)/, ['בשמחה! ❤️', 'אין על מה 😊']],
    [/(נכד|נכדה|נכדים|ילדים|משפחה)/, ['משפחה זה הכי חשוב ❤️ ספרי לי עוד!', 'איזו נחת! שיהיו בריאים']],
    [/(עייפה|עייף|קשה|כואב|לא טוב|עצובה)/, ['אוי, מקווה שתרגישי טוב יותר. אפשר לעשות הפסקה מתי שרוצים ☕', 'תשמרי על עצמך, {me}. אנחנו פה, אין לחץ ❤️']],
    [/(טוב|מצוין|בסדר|נהדר|שמחה)/, ['איזה יופי! 😊', 'שמחה לשמוע!']],
    [/(בהצלחה|שיהיה)/, ['גם לך! 🍀', 'תודה, נצטרך את זה מולך 😄']],
    [/(חחח|😂|😄|צחוק)/, ['😄😄', 'חחח, את מצחיקה!']],
    [/(ברידג|חלוקה|הכרזה|קלף|קלפים)/, ['ברידג׳ זה המשחק הכי יפה בעולם 🃏', 'עם הקלפים האלה את עושה פלאים']],
  ];
  for (const [re, opts] of rules) if (re.test(t)) return { seat, text: fill(pick(opts, ctx.rng), ctx) };
  return { seat, text: fill(pick(['מעניין! ספרי לי עוד 😊', 'אהבתי 😊', 'איזה יופי, {me}', 'אני מסכימה איתך!'], ctx.rng), ctx) };
}

// ---------- אירועים במשחק ----------
/** @param {'tournamentStart'|'roundStart'|'boardEnd'|'trickWonByHer'|'contractMade'|'contractSet'|'oppBid'} kind */
export function eventLines(kind, ctx, data = {}) {
  const { names, rng } = ctx;
  /** @type {Line[]} */
  const out = [];
  if (kind === 'tournamentStart') {
    out.push({ seat: 0, text: fill(pick(['{me} יקרה, איזה כיף לשחק איתך! בהצלחה לנו ❤️', 'שלום שותפה! מוכנה לנצח את העולם? 🏆'], rng), ctx) });
  }
  if (kind === 'roundStart') {
    const c = names[1].country || 'רחוק';
    out.push({ seat: 3, text: fill(pick(['שלום {me}! ד״ש חם מ{c} {f}', 'ערב טוב! שמחים לשבת מולך 😊', 'שלום! שמענו שאת שחקנית חזקה 😅'], rng), ctx, { c, f: names[3].flag }) });
    out.push({ seat: 1, text: fill(pick(['נעים להכיר! שיהיה משחק טוב 🍀', 'שלום לכולם! בהצלחה', 'היי! איזה כיף לשחק עם ישראלים'], rng), ctx) });
  }
  if (kind === 'boardEnd') {
    const pct = data.pct ?? 50;
    if (pct >= 60) {
      out.push({ seat: 0, text: fill(pick(['כל הכבוד {me}! תוצאה מצוינת 👏', 'איזה שיחקת! 🌟', 'וואו, {me}, את בכושר היום!'], rng), ctx) });
      if (rng() < 0.6) out.push({ seat: pick([1, 3], rng), text: pick(['שיחקת נהדר, אין מה לעשות 👏', 'הפעם ניצחת אותנו בגדול 😅', 'Bravo! (ככה אומרים אצלנו) 👏'], rng) });
    } else if (pct >= 40) {
      out.push({ seat: 0, text: fill(pick(['תוצאה יפה, ממשיכים 😊', 'יצא בסדר, החלוקה הבאה שלנו', 'לא רע בכלל!'], rng), ctx) });
    } else {
      out.push({ seat: 0, text: fill(pick(['לא נורא, {me}. החלוקה הבאה שלנו 💪', 'חלוקה קשה, גם אני לא הייתי מצליחה יותר', 'קורה לטובים ביותר. ממשיכות! ❤️'], rng), ctx) });
      if (rng() < 0.5) out.push({ seat: pick([1, 3], rng), text: pick(['היה לנו מזל הפעם 🍀', 'הקלפים היו לטובתנו, זה הכול'], rng) });
    }
  }
  if (kind === 'contractMade') out.push({ seat: 0, text: fill(pick(['איזה משחק! עשית את החוזה ✨', 'שיחקת את זה כמו אלופה 🏆', 'יופי של משחק, {me}!'], rng), ctx) });
  if (kind === 'contractSet') out.push({ seat: 0, text: pick(['הפלנו אותם! 🎉', 'הגנה מצוינת! 👏', 'ככה מגינים!'], rng) });
  if (kind === 'trickWonByHer') out.push({ seat: pick([0, 1, 3], rng), text: pick(['יפה!', 'לקיחה יפה 👌', 'אוהו!', 'חזק 💪'], rng) });
  if (kind === 'oppBid') out.push({ seat: data.seat, text: pick(['הממ... 🤔', 'נראה מה יש לכם...', 'קלפים מעניינים היום', 'בואו ננסה'], rng) });
  return out;
}

// ---------- התייעצות עם השותפה ----------
/** למה השותפה ממליצה על ההכרזה הזו (על סמך היד של נסיה בלבד) */
export function bidAdviceText(call, hand, ctx) {
  const hcp = handHcp(hand), len = suitLengths(hand);
  const longest = [3, 2, 1, 0].reduce((a, s) => (len[s] > len[a] ? s : a), 3);
  const bal = len.every((l) => l >= 2) && len.filter((l) => l === 2).length <= 1;
  let why;
  if (call === PASS) why = hcp < 12 ? `עם ${hcp} נקודות אני הייתי מחכה` : 'כרגע עדיף לא להמשיך, נראה מה יקרה';
  else if (call === DOUBLE) why = 'כפל: שידעו שיש לנו מה להגיד 😉';
  else if (call === REDOUBLE) why = 'כפל חוזר! אנחנו בעניין 💪';
  else if (strainOf(call) === 4) why = bal ? `יד מאוזנת עם ${hcp} נקודות` : `יש לך ${hcp} נקודות ועצירות`;
  else {
    const s = strainOf(call);
    why = `יש לך ${len[s]} ${SUIT_NAME[s]} ו-${hcp} נקודות`;
    if (s !== longest && len[longest] > len[s]) why = `${hcp} נקודות, וזו ההכרזה הכי נכונה עכשיו`;
  }
  const open = pick(['{me}, מה דעתך?', 'אני חושבת...', 'התייעצות קטנה:'], ctx.rng);
  return fill(`${open} אני הייתי מכריזה ${callWords(call)}. ${why}.`, ctx);
}

/** השותפה מסבירה מה הכרזתה האחרונה אומרת (לפי מה שהשיטה מראה) */
export function explainPartnerBid(call, info, ctx) {
  if (call == null) return 'עוד לא הכרזתי כלום 😊';
  if (call === PASS) return 'עשיתי פס, אין לי מספיק כדי להכריז עכשיו.';
  if (call === DOUBLE) return 'הכפל שלי אומר שיש לי נקודות ותמיכה בסדרות האחרות. תבחרי סדרה טובה 😉';
  if (!isBid(call)) return 'כפל חוזר: יש לי יד טובה!';
  const lo = Math.round(info.lo), hi = info.hi >= 37 ? null : Math.round(info.hi);
  const pts = hi !== null ? `${lo} עד ${hi} נקודות` : `לפחות ${lo} נקודות`;
  const s = strainOf(call);
  const len = s < 4 && info.len[s] ? `, ולפחות ${info.len[s]} ${SUIT_NAME[s]}` : s === 4 ? ', יד מאוזנת' : '';
  return fill(`הכרזתי ${callWords(call)}: יש לי ${pts}${len}.`, ctx);
}

/** עצה במשחק הקלפים */
export function cardAdviceText(card, winsNow, ctx) {
  const why = winsNow ? 'כדי לקחת את הלקיחה' : pick(['ולשמור את הגבוהים לאחר כך', 'הוא הכי בטוח עכשיו'], ctx.rng);
  return fill(`${pick(['{me}, ', '', 'אני חושבת ש'], ctx.rng)}הייתי משחקת ${cardWords(card)}, ${why}.`, ctx);
}
