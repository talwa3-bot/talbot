// Home-screen installation: native prompt where supported, instructions elsewhere.
export function createInstall({ openSheet, closeSheet, onChange }) {
  /** @type {any} */ let promptEvent = null;
  let offlineReady = false;
  const standalone = window.matchMedia('(display-mode: standalone)');
  const installed = () => standalone.matches || /** @type {any} */ (navigator).standalone === true;
  const ios = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); promptEvent = e; onChange();
  });
  window.addEventListener('appinstalled', () => { promptEvent = null; closeSheet(); onChange(); });
  standalone.addEventListener('change', onChange);
  function open() {
    const steps = ios()
      ? '<li>פתחי את המשחק ב־<b>Safari</b>.</li><li>לחצי על <b>שיתוף</b> — ריבוע עם חץ כלפי מעלה. ייתכן שהוא בתוך תפריט הדפדפן.</li><li>בחרי <b>הוסף למסך הבית</b>. אם האפשרות חסרה, חפשי אותה ב״עריכת פעולות״.</li><li>אם מופיע ״פתח כיישום אינטרנט״, הפעילי אותו. לחצי על <b>הוסף</b>.</li>'
      : '<li>פתחי את המשחק בדפדפן הטלפון.</li><li>פתחי את תפריט הדפדפן <b>⋮</b>.</li><li>בחרי <b>התקנת אפליקציה</b> או <b>הוספה למסך הבית</b>, ואשרי.</li>';
    openSheet(`<h2>הברידג׳ במסך הבית</h2>
      <div class="install-preview"><img src="icons/icon-180.png" width="80" height="80" alt="אייקון הברידג׳: אס לב על רקע ירוק"><b>ברידג׳</b></div>
      <p>אחרי ההוספה, לחיצה על האייקון תפתח את המשחק.</p>
      ${promptEvent ? '<button class="btn primary big" data-act="native-install">הוסיפי את המשחק לטלפון</button>' : `<ol class="install-steps">${steps}</ol>`}
      <p>ההוספה נעשית בטלפון עצמו. השמירה היא במכשיר ובדפדפן הזה; היא אינה מסתנכרנת בין מכשירים.</p>
      <button class="btn big" data-act="close">הבנתי</button>`, async (act, button) => {
        if (act !== 'native-install') { closeSheet(); return; }
        const event = promptEvent;
        if (!event) { open(); return; }
        promptEvent = null;
        button.disabled = true;
        try { await event.prompt(); await event.userChoice; } catch { /* Show manual instructions below. */ }
        open();
      });
  }
  return {
    open,
    setOfflineReady() { offlineReady = true; onChange(); },
    card() {
      return `<section class="card-panel install-card" aria-label="התקנת המשחק">
        <img src="icons/icon-180.png" width="64" height="64" alt="">
        <div><h2>${installed() ? 'הברידג׳ שלך מוכן' : 'המשחק שלך, בלחיצה אחת'}</h2>
        <p>${installed() ? 'פתחת את המשחק כאפליקציה.' : 'הוסיפי אייקון של ברידג׳ למסך הבית בטלפון.'}</p></div>
        ${installed() ? '' : '<button class="btn big" data-act="install">הוספה למסך הבית</button>'}
        <p class="offline-status" role="status">${offlineReady ? '✓ המשחק מוכן גם למשחק ללא אינטרנט' : 'למשחק ללא אינטרנט, השאירי את המשחק פתוח עד לסיום ההכנה.'}</p>
      </section>`;
    },
  };
}
