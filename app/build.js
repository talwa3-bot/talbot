#!/usr/bin/env node
/* בונה קובץ HTML יחיד שעובד ללא אינטרנט: כל הספריות והקוד מוטמעים בתוכו.
 * שימוש: node app/build.js  =>  app/dist/shareholder-interest-tool.html */
const fs = require('fs');
const path = require('path');

const root = __dirname;
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
// מונע סגירת תג script בטעות בתוך קוד מוטמע
const safe = (js) => js.replace(/<\/script/gi, '<\\/script');

const order = [
  'vendor/xlsx.full.min.js',
  'vendor/exceljs.min.js',
  'src/lib/calc.js',
  'src/lib/parse.js',
  'src/lib/export-common.js',
  'src/lib/export-interest.js',
  'src/lib/classify.js',
  'src/lib/export-analysis.js',
  'src/lib/pipeline.js',
  'src/ui-analysis.js',
  'src/ui.js',
].filter((p) => fs.existsSync(path.join(root, p)));

const scripts = order.map((p) => `<script>/* ${p} */\n${safe(read(p))}\n</script>`).join('\n');
let html = read('src/index.html');
html = html.replace('/*{{CSS}}*/', () => read('src/styles.css'));
html = html.replace('<!--{{SCRIPTS}}-->', () => scripts);

const outDir = path.join(root, 'dist');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, 'shareholder-interest-tool.html');
fs.writeFileSync(out, html);

// בדיקת אי-תלות ברשת: אסור שיהיו הפניות חיצוניות בתגי script/link/img
const ext = html.match(/<(script|link|img|iframe)[^>]+(src|href)\s*=\s*["']https?:/gi);
if (ext) {
  console.error('נמצאו הפניות חיצוניות:', ext);
  process.exit(1);
}
console.log('נבנה:', out, (fs.statSync(out).size / 1024 / 1024).toFixed(2) + 'MB');
