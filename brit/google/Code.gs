const SHEET_ID = '1AMIWLzlNMblPipkByDGLN9qpepJxsFSzaU6ktR0TubY';
// כתובות המייל שיקבלו הודעה על כל אישור (אפשר כמה, מופרדות בפסיק)
const NOTIFY_EMAIL = 'Yohalomi@gmail.com';

// מציג את דף האישור לאורחים
function doGet(e) {
  const t = HtmlService.createTemplateFromFile('index');
  t.prefill = (e && e.parameter && e.parameter.name) || '';
  return t.evaluate()
    .setTitle('אישור הגעה לברית')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// נקרא מהדף בעת שליחה
function submitRSVP(d) {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheets()[0];
  const coming = d.status === 'yes';
  const name = String(d.name || '').slice(0, 100);
  const guests = coming ? Math.max(1, Math.min(30, Number(d.guests) || 1)) : 0;
  sheet.appendRow([new Date(), name, coming ? 'מגיעים' : 'לא מגיעים', guests]);
  try {
    MailApp.sendEmail(NOTIFY_EMAIL, 'אישור הגעה לברית: ' + name,
      name + ' - ' + (coming ? 'מגיעים, ' + guests + ' אורחים' : 'לא מגיעים'));
  } catch (err) {}
  return 'ok';
}

// הרצה ידנית אחת לצורך אישור הרשאות ובדיקה
function testWrite() {
  submitRSVP({ name: 'בדיקה', status: 'yes', guests: 1 });
}
