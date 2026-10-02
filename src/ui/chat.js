// חלון הצ'אט: הודעות, "מקלידה...", תשובות מוכנות ושדה כתיבה חופשית.
// יושב מחוץ ל-#app, כדי שעדכוני השולחן לא ימחקו טקסט שנסיה באמצע כתיבתו.
import { freeReply, answerReply, honestAnswer } from '../game/chatter.js';

/** @typedef {{id:number, seat:number, text:string, replies?:string[], qkey?:string, answered?:boolean, typing?:boolean, at:number}} Msg */

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HONEST_RE = /(רובוט|בוט|אמיתי|אמיתית|אמיתיים|מחשב|מכונה|תוכנה|בינה מלאכותית)/;

/**
 * @param {{
 *   getCtx: () => any,
 *   persona: (seat:number) => string,
 *   gameSummary: () => string,
 *   onChange: () => void,
 *   load: () => Msg[],
 *   save: (msgs: Msg[]) => void,
 *   quick: () => {label:string, act:string}[],
 *   onQuick: (act:string) => void,
 * }} o
 */
export function createChat(o) {
  /** @type {Msg[]} */
  let msgs = o.load() || [];
  let seq = msgs.reduce((m, x) => Math.max(m, x.id), 0);
  let open = false, unread = 0;
  let queue = Promise.resolve();
  /** @type {any} */ let sample = null;
  const wideMq = window.matchMedia('(min-width: 1000px)');

  // שיחה חכמה דרך Claude, רק כשהעמוד רץ ב-claude.ai והיכולת זמינה
  try {
    const c = /** @type {any} */ (window).claude;
    if (c && typeof c.use === 'function') c.use('sample').then((s) => { sample = s; }).catch(() => {});
  } catch { /* אין */ }

  const root = document.createElement('aside');
  root.id = 'chat-root';
  root.setAttribute('aria-label', 'צ׳אט עם השחקנים');
  document.body.appendChild(root);

  function persist() { o.save(msgs.filter((m) => !m.typing).slice(-60)); }
  const isWide = () => wideMq.matches;

  /** תור הודעות: כל הודעה עם "מקלידה..." לפני */
  function post(lines, { first = 600 } = {}) {
    queue = queue.then(async () => {
      let wait = first;
      for (const line of lines) {
        const typing = { id: ++seq, seat: line.seat, text: '', typing: true, at: Date.now() };
        await sleep(wait);
        msgs.push(typing); draw(); o.onChange();
        await sleep(Math.min(2600, 700 + line.text.length * 28));
        msgs = msgs.filter((m) => m !== typing);
        msgs.push({ id: ++seq, seat: line.seat, text: line.text, replies: line.replies, qkey: line.qkey, at: Date.now() });
        if (!open && !isWide()) unread++;
        persist(); draw(); o.onChange();
        wait = 900;
      }
    });
    return queue;
  }

  /** נסיה שולחת הודעה */
  async function herMessage(text, fromReply) {
    text = text.trim();
    if (!text) return;
    // ההודעה האחרונה שמחכה לתשובה
    const pending = [...msgs].reverse().find((m) => m.replies && !m.answered && m.seat !== 2);
    if (pending) pending.answered = true;
    msgs.push({ id: ++seq, seat: 2, text, at: Date.now() });
    persist(); draw(); o.onChange();
    const ctx = o.getCtx();
    // למי לענות: למי שנזכר בשם, אחרת למי ששאל, אחרת לשותפה
    let seat = pending ? pending.seat : 0;
    ctx.names.forEach((n, s) => { if (s !== 2 && n.name && text.includes(n.name)) seat = s; });
    if (fromReply && pending && pending.qkey) {
      const idx = (pending.replies || []).indexOf(text);
      const r = answerReply(pending.qkey, idx, ctx, seat);
      if (r) return post([r], { first: 500 });
    }
    if (HONEST_RE.test(text)) return post([honestAnswer(ctx, seat)], { first: 500 });
    if (sample) {
      const typing = { id: ++seq, seat, text: '', typing: true, at: Date.now() };
      await queue;
      msgs.push(typing); draw(); o.onChange();
      try {
        const res = await sample(smartTurns(seat, text), { modelTier: 'quick', cache: false });
        msgs = msgs.filter((m) => m !== typing);
        const t = String(res.text || '').trim().slice(0, 400);
        if (t) {
          msgs.push({ id: ++seq, seat, text: t, at: Date.now() });
          if (!open && !isWide()) unread++;
          persist(); draw(); o.onChange();
          return;
        }
      } catch { /* נופלים לתשובה מוכנה */ }
      msgs = msgs.filter((m) => m !== typing);
    }
    return post([freeReply(text, ctx, seat)], { first: 400 });
  }

  /** הוראות לשיחה החכמה: הדמות, הכללים, המצב במשחק והשיחה עד עכשיו */
  function smartTurns(seat, text) {
    const ctx = o.getCtx();
    const rules = [
      `את/ה ${o.persona(seat)}`,
      `את/ה משחק/ת ברידג׳ טורניר עם ${ctx.me}, אישה בת 90 מישראל, שחקנית ברידג׳ מעולה. השותפה שלה היא רות.`,
      'ענה/י בעברית פשוטה, חמה ומכבדת. משפט אחד או שניים בלבד, כמו בצ׳אט. אפשר אימוג׳י אחד.',
      'פני/ה אליה בלשון נקבה. התעניין/י בה באמת, שאל/י לפעמים שאלה חזרה.',
      'אם היא שואלת אם את/ה אדם אמיתי, רובוט או מחשב: אמור/י בכנות ובחום שאת/ה דמות ממוחשבת במשחק.',
      'אל תיתן/י עצות רפואיות, משפטיות או כספיות. אל תבקש/י פרטים אישיים, כסף או קישורים.',
      'אל תגלה/י אילו קלפים יש לך.',
      `מצב המשחק: ${o.gameSummary()}`,
    ].join('\n');
    const ctxNames = o.getCtx().names;
    const history = msgs.filter((m) => !m.typing).slice(-10)
      .map((m) => `${m.seat === 2 ? ctx.me : ctxNames[m.seat].name}: ${m.text}`).join('\n');
    return `${rules}\n\nהשיחה עד עכשיו:\n${history}\n\n${ctx.me} כתבה עכשיו: "${text}"\n\nכתוב/י רק את התשובה של ${ctxNames[seat].name}, בלי שם ובלי מרכאות.`;
  }

  function draw() {
    const oldInput = /** @type {HTMLInputElement|null} */ (root.querySelector('#chat-input'));
    const draft = oldInput?.value || '';
    const focused = document.activeElement === oldInput;
    const start = oldInput?.selectionStart, end = oldInput?.selectionEnd;
    const ctx = o.getCtx();
    const wide = isWide();
    document.body.classList.toggle('chat-side', wide);
    root.className = wide ? 'side' : open ? 'drawer open' : 'drawer';
    if (!wide && !open) { root.innerHTML = ''; return; }
    const last = [...msgs].reverse().find((m) => !m.typing);
    const pending = last && last.replies && !last.answered && last.seat !== 2 ? last : null;
    const quick = o.quick();
    root.innerHTML = `
      <div class="chat-head"><b>💬 שיחה ליד השולחן</b>${wide ? '' : '<button class="chat-x" data-chat="close" aria-label="סגירה">✕</button>'}</div>
      <div class="chat-list" role="log">${msgs.map((m) => {
        const who = m.seat === 2 ? 'me' : 'them';
        const n = ctx.names[m.seat] || { name: '', flag: '' };
        return `<div class="msg ${who}">${m.seat !== 2 ? `<div class="who">${n.flag} ${esc(n.name)}</div>` : ''}
          <div class="txt">${m.typing ? '<span class="dots"><i></i><i></i><i></i></span>' : esc(m.text)}</div></div>`;
      }).join('') || '<p class="muted chat-empty">כאן אפשר לדבר עם השחקנים</p>'}</div>
      <div class="chat-quick">${pending ? pending.replies.map((r) => `<button data-chat="reply">${esc(r)}</button>`).join('') : ''}
        ${quick.map((q) => `<button class="q" data-chat-act="${q.act}">${esc(q.label)}</button>`).join('')}</div>
      <form class="chat-form" autocomplete="off">
        <input id="chat-input" aria-label="הודעה לשחקנים" type="text" maxlength="300" placeholder="לכתוב הודעה..." enterkeyhint="send">
        <button type="submit" class="send">שלחי</button>
      </form>`;
    const input = /** @type {HTMLInputElement|null} */ (root.querySelector('#chat-input'));
    if (input) { input.value = draft; if (focused) { input.focus(); input.setSelectionRange(start, end); } }
    const list = root.querySelector('.chat-list');
    if (list) list.scrollTop = list.scrollHeight;
  }

  root.addEventListener('click', (e) => {
    const t = /** @type {HTMLElement} */ (e.target);
    const b = /** @type {HTMLElement|null} */ (t.closest('[data-chat],[data-chat-act]'));
    if (!b) return;
    if (b.dataset.chat === 'close') { open = false; draw(); o.onChange(); }
    else if (b.dataset.chat === 'reply') herMessage(b.textContent || '', true);
    else if (b.dataset.chatAct) o.onQuick(b.dataset.chatAct);
  });
  root.addEventListener('submit', (e) => {
    e.preventDefault();
    const inp = /** @type {HTMLInputElement|null} */ (root.querySelector('#chat-input'));
    if (!inp) return;
    const v = inp.value;
    inp.value = '';
    herMessage(v, false);
  });
  wideMq.addEventListener('change', () => { draw(); o.onChange(); });

  return {
    post,
    draw,
    get unread() { return unread; },
    toggle() { open = !open; if (open) unread = 0; draw(); o.onChange(); },
    reset() { msgs = []; unread = 0; persist(); draw(); },
    /** ההודעה האחרונה של כל מושב ב-6 השניות האחרונות, לבועה ליד השם */
    bubble(seat) {
      // רק ההודעה האחרונה (של מישהו שאינו נסיה) מוצגת כבועה, כדי שלא יתערבבו
      const m = [...msgs].reverse().find((x) => x.seat !== 2);
      if (!m || m.seat !== seat) return null;
      if (m.typing) return { typing: true, text: '' };
      return Date.now() - m.at < 6500 ? { typing: false, text: m.text, question: !!(m.replies && !m.answered) } : null;
    },
    /** ההודעה האחרונה לתצוגה בטלפון: {seat, text, typing, question} */
    peek() {
      const m = [...msgs].reverse().find((x) => x.seat !== 2);
      if (!m) return null;
      if (m.typing) return { seat: m.seat, text: '', typing: true, question: false };
      return Date.now() - m.at < 9000 || (m.replies && !m.answered) ? { seat: m.seat, text: m.text, typing: false, question: !!(m.replies && !m.answered) } : null;
    },
    askedKeys() { return msgs.filter((m) => m.qkey).map((m) => m.qkey); },
    hasPendingQuestion() { const l = [...msgs].reverse().find((m) => !m.typing); return !!(l && l.replies && !l.answered && l.seat !== 2); },
    smartAvailable() { return !!sample; },
    /** נסיה כותבת משהו (מכפתור מהיר) */
    say(text) { return herMessage(text, false); },
  };
}
