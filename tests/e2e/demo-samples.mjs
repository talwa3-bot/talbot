// Uploads the files in samples/ into the static demo the way a user would, then asks about Q2.
import { chromium } from "playwright";
const file = new URL("../../dist-demo/ledgerlens-demo.html", import.meta.url).href;
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
const page = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const errors = []; page.on("pageerror", (e) => errors.push(e.message));
const res = {};
const as = async (i) => { if (await page.$("#logout:not([hidden])")) await page.click("#logout"); await page.click(`.user >> nth=${i}`); await page.waitForSelector("#nav a"); };
const upload = async (kind, name, total) => {
  await page.selectOption("#kind", kind); await page.setInputFiles("#file", `samples/${name}`); await page.fill("#ct", total);
  if (kind === "plan") await page.fill("#plan_name", "Budget 2026 v2");
  await page.evaluate(() => (document.querySelector("#impres").innerHTML = ""));
  await page.click("#chk"); await page.waitForSelector("#impres .notice");
};
await page.goto(file); await page.waitForSelector(".user");
await as(5); // data steward
await upload("actual", "03-actuals-with-errors.csv", "20000.00");
res.errorsShown = await page.$$eval("#impres tbody tr", (r) => r.length);
await page.screenshot({ path: "samples/screenshots/1-errors.png", fullPage: true });
await upload("actual", "01-actuals-ytd-2026.csv", "416601.25");
res.actualsPassed = !!(await page.$("#pub")); await page.click("#pub"); await page.waitForSelector("#impres .notice.ok >> text=/פורסם|Published/");
await upload("plan", "02-budget-2026-v2.csv", "792000.00");
await page.click("#pub"); await page.waitForSelector("#impres .notice.ok >> text=/פורסם|Published/");
res.context = await page.textContent("#context");
await as(0); // CFO
await page.fill("#q", "מה החריגה בהוצאות התפעול ברבעון השני?"); await page.click("#askb"); await page.waitForSelector("#answer table");
const txt = await page.textContent("#answer");
res.q2 = txt.includes("3,001.25") && txt.includes("5.56");
await page.screenshot({ path: "samples/screenshots/2-q2-answer.png", fullPage: true });
await page.evaluate(() => (document.querySelector("#answer").innerHTML = ""));
await page.fill("#q", "הוצאות במאי 2026"); await page.click("#askb"); await page.waitForSelector("#answer table");
res.may = (await page.textContent("#answer")).includes("9,350.50");
console.log(res, errors);
await b.close();
if (!res.q2 || !res.may || !res.context.includes("v2") || res.errorsShown < 7 || !res.actualsPassed || errors.length) process.exit(1);
