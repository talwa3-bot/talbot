// Google Apps Script: receives RSVP and appends a row to the sheet.
const SHEET_ID = '1AMIWLzlNMblPipkByDGLN9qpepJxsFSzaU6ktR0TubY';
// כתובת המייל שתקבל הודעה על כל אישור הגעה (אפשר כמה, מופרדות בפסיק)
const NOTIFY_EMAIL = 'Yohalomi@gmail.com';

function doPost(e) {
  const p = (e && e.parameter) || {};
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheets()[0];
  const coming = p.status === 'yes';
  sheet.appendRow([
    new Date(),
    String(p.name || '').slice(0, 100),
    coming ? 'מגיעים' : 'לא מגיעים',
    coming ? Math.max(1, Math.min(30, Number(p.guests) || 1)) : 0
  ]);
  const guests = coming ? sheet.getRange(sheet.getLastRow(), 4).getValue() : 0;
  try {
    MailApp.sendEmail(NOTIFY_EMAIL,
      'אישור הגעה לברית: ' + p.name,
      p.name + ' - ' + (coming ? 'מגיעים, ' + guests + ' אורחים' : 'לא מגיעים'));
  } catch (err) {}
  return ContentService.createTextOutput('ok');
}

// Run this once from the editor (select it in the dropdown, press Run).
// It asks for permissions and adds a test row to verify the connection.
function testWrite() {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheets()[0];
  sheet.appendRow([new Date(), 'בדיקה', 'מגיעים', 1]);
}
