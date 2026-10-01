// Google Apps Script: receives RSVP and appends a row to the sheet.
const SHEET_ID = '1AMIWLzlNMblPipkByDGLN9qpepJxsFSzaU6ktR0TubY';

function doPost(e) {
  const p = e.parameter;
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheets()[0];
  const coming = p.status === 'yes';
  sheet.appendRow([
    new Date(),
    String(p.name || '').slice(0, 100),
    coming ? 'מגיעים' : 'לא מגיעים',
    coming ? Math.max(1, Math.min(30, Number(p.guests) || 1)) : 0
  ]);
  return ContentService.createTextOutput('ok');
}
