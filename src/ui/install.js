// Show a real install action only while the browser supplies an install prompt.
export function installBrowser(ua, platform = '', touchPoints = 0) {
  if (/iPad|iPhone|iPod/.test(ua) || (platform === 'MacIntel' && touchPoints > 1)) return 'ios';
  if (/; wv\)|\bwv\b|FBAN|FBAV|Instagram/.test(ua)) return 'embedded';
  if (/SamsungBrowser\//.test(ua)) return 'samsung';
  if (/Android/.test(ua) && /Chrome\//.test(ua) && !/EdgA|OPR\//.test(ua)) return 'chrome';
  return 'other';
}

export function createInstall({ openSheet, closeSheet, onChange }) {
  /** @type {any} */ let promptEvent = null;
  let offlineReady = false, accepted = false, installing = false;
  let sheet = null;
  let selectedBrowser = installBrowser(navigator.userAgent, navigator.platform, navigator.maxTouchPoints);
  const standalone = window.matchMedia('(display-mode: standalone)');
  const installed = () => accepted || standalone.matches || /** @type {any} */ (navigator).standalone === true;
  const gameUrl = new URL('./', location.href).href;
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const refresh = () => {
    onChange();
    // A delayed browser prompt must also update instructions already on screen.
    if (sheet?.isConnected && !installing) showGuide();
  };
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault(); promptEvent = e; refresh();
  });
  window.addEventListener('appinstalled', () => { accepted = true; promptEvent = null; refresh(); });
  standalone.addEventListener('change', refresh);

  async function startInstall() {
    const event = promptEvent;
    if (!event) { showGuide(); return; }
    promptEvent = null;
    installing = true;
    onChange();
    if (sheet?.isConnected) sheet.querySelectorAll('button').forEach(b => { b.disabled = true; });
    try {
      await event.prompt();
      const choice = await event.userChoice;
      accepted = choice.outcome === 'accepted';
    } catch { /* Keep manual alternatives available if the browser rejects the prompt. */ }
    installing = false;
    onChange();
    showGuide();
  }

  function showGuide(missing = false) {
    const steps = {
      samsung: '<li>פתחי את תפריט <b>☰ של Samsung Internet</b>, בדרך כלל בתחתית המסך.</li><li>חפשי <b>״הוסף דף אל״</b> או <b>״הוסף דף ל־״</b> (Add page to), ולחצי עליו.</li><li>בחרי <b>״מסך הבית״</b> ואז <b>״הוסף״</b>.</li>',
      chrome: '<li>פתחי את תפריט <b>⋮ של Chrome</b>, ליד שורת הכתובת.</li><li>חפשי <b>״הוספה למסך הבית״</b> או <b>״התקנת אפליקציה״</b>.</li><li>אם מופיע ״יצירת קיצור דרך״, אפשר לבחור בו. אשרי ב־<b>״הוסף״</b> או ״התקנה״.</li>',
      ios: '<li>פתחי את המשחק ב־<b>Safari</b>.</li><li>לחצי על <b>שיתוף</b> — ריבוע עם חץ למעלה.</li><li>בחרי <b>״הוסף למסך הבית״</b>, ואז <b>״הוסף״</b>.</li>',
      embedded: '<li>פתחי את תפריט האפליקציה שבה נפתח הקישור.</li><li>אם מופיע <b>״פתיחה בדפדפן״</b>, בחרי בו. אם לא, השתמשי בכפתור ״העתקת קישור״ למטה.</li><li>פתחי בעצמך את <b>Chrome</b> או <b>Samsung Internet</b> בטלפון, והדביקי את הקישור בשורת הכתובת.</li>',
      other: '<li>בטלפון, פתחי את הקישור ב־<b>Samsung Internet</b>, ב־<b>Chrome</b> או ב־<b>Safari</b>.</li><li>בחרי כאן את הדפדפן כדי לראות את ההוראות המתאימות.</li>',
    };
    const names = { samsung: 'Samsung Internet', chrome: 'Chrome באנדרואיד', ios: 'Safari באייפון', embedded: 'חלון בתוך אפליקציה', other: 'דפדפן אחר' };
    const help = missing
      ? '<p><b>אין צורך להמשיך לחפש את אותה אפשרות.</b> העתיקי את הקישור, פתחי את Chrome בטלפון והדביקי אותו בשורת הכתובת. אפשר לשחק מיד, גם בלי אייקון.</p>'
      : `<p>הוראות עבור <b>${names[selectedBrowser]}</b>. שמות התפריטים עשויים להשתנות בין גרסאות.</p><ol class="install-steps">${steps[selectedBrowser]}</ol>`;
    sheet = openSheet(`<h2>${installed() ? 'הברידג׳ מוכן לפתיחה' : 'הברידג׳ כאפליקציה בטלפון'}</h2>
      <div class="install-preview"><img src="icons/icon-180.png" width="80" height="80" alt="אייקון ברידג׳"><b>ברידג׳</b></div>
      ${installed() ? '<p>חפשי את אייקון הברידג׳ במסך הבית או ברשימת האפליקציות. אם ההתקנה אושרה כרגע, ייתכן שייקח רגע עד שיופיע.</p>' : `
        ${promptEvent ? '<button class="btn primary big" data-act="native-install">התקיני את הברידג׳</button><p>הכפתור יפתח בקשת התקנה של הטלפון.</p>' : '<p>כדי שהמשחק יופיע כמו אפליקציה רגילה, צריך לפתוח את הקישור <b>בטלפון עצמו</b> ולהוסיף אותו למסך הבית. הדפדפן הזה לא מציע כרגע התקנה ישירה.</p>'}
        ${help}
        <div class="seg" role="group" aria-label="בחירת הדפדפן">
          <button data-act="samsung" aria-pressed="${selectedBrowser === 'samsung'}">דפדפן סמסונג</button>
          <button data-act="chrome" aria-pressed="${selectedBrowser === 'chrome'}">Chrome</button>
          <button data-act="ios" aria-pressed="${selectedBrowser === 'ios'}">אייפון</button>
        </div>
        ${missing ? '' : '<p><button class="btn big" data-act="missing">האפשרות לא מופיעה אצלי</button></p>'}
        <p><button class="btn big" data-act="copy">העתקת הקישור למשחק</button></p>
        <input type="text" readonly dir="ltr" aria-label="הקישור למשחק" value="${esc(gameUrl)}" style="user-select:text;-webkit-user-select:text">
        <p role="status" id="install-feedback"></p>`}
      <p><button class="btn big" data-act="close">חזרה למשחק</button></p>`, async (act) => {
        if (act === 'native-install') { await startInstall(); return; }
        if (act === 'missing') { showGuide(true); return; }
        if (['samsung', 'chrome', 'ios'].includes(act)) { selectedBrowser = act; showGuide(); return; }
        if (act === 'copy') {
          const feedback = sheet.querySelector('#install-feedback');
          try {
            await navigator.clipboard.writeText(gameUrl);
            feedback.textContent = 'הקישור הועתק. פתחי את הדפדפן בטלפון והדביקי בשורת הכתובת.';
          } catch {
            const input = sheet.querySelector('input'); input.focus(); input.select();
            feedback.textContent = 'לחצי לחיצה ארוכה על הקישור המסומן ובחרי ״העתק״.';
          }
          return;
        }
        closeSheet(); sheet = null;
      });
  }
  return {
    open() { if (promptEvent && !installed()) return startInstall(); showGuide(); },
    setOfflineReady() { offlineReady = true; onChange(); },
    card() {
      return `<section class="card-panel install-card" aria-label="התקנת המשחק">
        <img src="icons/icon-180.png" width="64" height="64" alt="">
        <div><h2>${installed() ? 'הברידג׳ שלך מוכן' : 'הברידג׳ כאפליקציה בטלפון'}</h2>
        <p>${installed() ? 'אפשר לפתוח את המשחק מהאייקון.' : promptEvent ? 'ההתקנה זמינה בטלפון שלך.' : 'הכפתור פותח התקנה או הוראות להוספת אייקון למסך הבית בטלפון.'}</p></div>
        ${installed() ? '' : `<button class="btn primary big" data-act="install" ${installing ? 'disabled' : ''}>${installing ? 'ממתינים לאישור בטלפון…' : 'הורד את האפליקציה לטלפון'}</button>`}
        <p class="offline-status" role="status">${offlineReady ? '✓ המשחק מוכן גם למשחק ללא אינטרנט' : 'למשחק ללא אינטרנט, השאירי את המשחק פתוח עד לסיום ההכנה.'}</p>
      </section>`;
    },
  };
}
