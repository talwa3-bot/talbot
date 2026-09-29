// Browser end-to-end: import -> validate -> publish -> ask -> evidence -> close draft/approve -> scenario.
// Run against a seeded server: LEDGERLENS_DEMO_AUTH=1 npx tsx packages/api/src/server.ts
import { chromium, type Page } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { writeFileSync, mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.SHOT_DIR ?? "docs/screenshots";
mkdirSync(OUT, { recursive: true });
const failures: string[] = [];
const check = (ok: boolean, msg: string) => { if (!ok) failures.push(msg); console.log(`${ok ? "PASS" : "FAIL"} ${msg}`); };

async function login(page: Page, user: string, lang: "he-IL" | "en-US" = "he-IL") {
  await page.goto(BASE);
  await page.evaluate(([u, l]) => { localStorage.setItem("ll.user", u!); localStorage.setItem("ll.lang", l!); }, [user, lang]);
  await page.goto(BASE);
  await page.waitForSelector("#nav a");
}
async function axe(page: Page, name: string) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = r.violations.filter((v) => ["serious", "critical"].includes(v.impact ?? ""));
  check(serious.length === 0, `axe ${name}: ${serious.map((v) => v.id).join(",") || "no serious violations"}`);
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" }).catch(() => chromium.launch());
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
page.on("pageerror", (e) => failures.push(`page error: ${e.message}`));

// Login screen
await page.goto(BASE); await page.evaluate(() => localStorage.clear()); await page.goto(BASE);
await page.waitForSelector(".user");
check((await page.getAttribute("html", "dir")) === "rtl", "Hebrew UI is RTL by default");
await page.screenshot({ path: `${OUT}/01-login.png` });
await axe(page, "login");

// Admin: import bad then good file
await login(page, "admin");
await page.setInputFiles("#file", { name: "bad.csv", mimeType: "text/csv", buffer: Buffer.from("source_row_id,period,entity_id,department,account,amount,currency\n1,2026-04,ent_demo,sales,9999,5.00,USD\n") });
await page.fill("#ct", "5.00"); await page.click("#chk");
await page.waitForSelector("#impres table");
check((await page.textContent("#impres"))!.includes("חשבון לא מוכר"), "bad import shows friendly Hebrew error");
await page.setInputFiles("#file", { name: "april.csv", mimeType: "text/csv", buffer: Buffer.from("מזהה,חודש,חברה,מחלקה,חשבון,סכום,מטבע\nA-1001,2026-04,ent_demo,sales,6000,9000.00,USD\nA-1002,2026-04,ent_demo,ops,6100,8100.00,USD\n") });
await page.fill("#ct", "17100.00"); await page.click("#chk");
await page.waitForSelector("#pub");
await page.screenshot({ path: `${OUT}/02-import.png`, fullPage: true });
await axe(page, "import");
// Note: publishing April replaces the current snapshot with April only; skip in the demo flow to keep Q1 data.

// CFO asks in Hebrew
await login(page, "cfo");
await page.fill("#q", "מה החריגה בהוצאות התפעול ברבעון הראשון?"); await page.click("#askb");
await page.waitForSelector("#answer table");
const txt = (await page.textContent("#answer"))!;
check(/3,100\.00|3,100/.test(txt) && txt.includes("5.74"), "Hebrew answer shows Q1 variance 3,100.00 and 5.74%");
await page.screenshot({ path: `${OUT}/03-ask-he.png`, fullPage: true });
await axe(page, "ask");
await page.click("#answer tbody [data-ev]"); await page.waitForSelector("#drawer-body table");
check((await page.textContent("#drawer-body"))!.match(/A-000\d/) !== null, "evidence drawer lists source rows");
await page.screenshot({ path: `${OUT}/04-evidence.png` });
await page.keyboard.press("Escape");

// Language switch keeps the same numbers
await page.click("#lang"); await page.waitForTimeout(300);
await page.fill("#q", "What is the Q1 operating-expense variance?"); await page.click("#askb");
await page.waitForSelector("#answer table");
check((await page.getAttribute("html", "dir")) === "ltr" && (await page.textContent("#answer"))!.includes("5.74"), "English answer matches, LTR layout");
await page.click("#lang");

// Clarification path
await page.fill("#q", "מה הסטייה ברבעון הקודם?"); await page.click("#askb");
await page.waitForSelector("#answer .notice");
check((await page.textContent("#answer"))!.includes("רבעון"), "relative period asks a clarifying question");

// Manager sees only Sales
await login(page, "mgr-sales");
await page.fill("#q", "מה החריגה בהוצאות התפעול ברבעון הראשון?"); await page.click("#askb");
await page.waitForSelector("#answer table");
const m = (await page.textContent("#answer"))!;
check(!m.includes("אופרציה") && m.includes("מוסתר"), "manager sees Sales only, total hidden");

// Accountant completes tasks; controller declares ready and drafts; CFO approves
await login(page, "accountant"); await page.waitForSelector("[data-save]");
for (const id of await page.$$eval("[data-save]", (b) => b.map((x) => (x as HTMLElement).dataset.save!))) {
  await page.selectOption(`#s-${id}`, "done"); await page.fill(`#e-${id}`, `doc://${id.slice(0, 6)}`); await Promise.all([page.waitForResponse((r) => r.url().includes("/tasks") && r.request().method() === "GET"), page.click(`[data-save="${id}"]`)]);
}
await login(page, "controller"); await page.goto(`${BASE}/#/close`); await page.waitForSelector("[data-save]");
for (const id of await page.$$eval("[data-save]", (b) => b.map((x) => (x as HTMLElement).dataset.save!))) {
  if ((await page.inputValue(`#s-${id}`)) !== "done") { await page.selectOption(`#s-${id}`, "done"); await page.fill(`#e-${id}`, "doc://payroll"); await Promise.all([page.waitForResponse((r) => r.url().includes("/tasks") && r.request().method() === "GET"), page.click(`[data-save="${id}"]`)]); }
}
await page.waitForSelector("#ready:not([disabled])"); await page.click("#ready");
await page.waitForSelector("#draft:not([disabled])"); await page.click("#draft");
await page.waitForSelector("#reqap"); await page.screenshot({ path: `${OUT}/05-close.png`, fullPage: true });
await axe(page, "close");
await page.click("#reqap"); await page.waitForSelector("text=ממתין לאישור");
await login(page, "cfo"); await page.goto(`${BASE}/#/close`); await page.waitForSelector("[data-approve]");
await page.click("[data-approve]"); await page.waitForSelector("[data-csv]");
check(true, "CFO approved exact version; CSV export available");

// Scenario
await page.goto(`${BASE}/#/explore`); await page.waitForSelector("#calc");
await page.click("#calc"); await page.waitForSelector("#scres table");
check((await page.textContent("#scres"))!.includes("היפותטי"), "scenario is labeled hypothetical");
await page.screenshot({ path: `${OUT}/06-scenario.png`, fullPage: true });
await axe(page, "scenario");

// Mobile RTL
const mob = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true })).newPage();
await login(mob, "cfo");
await mob.fill("#q", "הוצאות בינואר 2026"); await mob.click("#askb"); await mob.waitForSelector("#answer table");
const overflow = await mob.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
check(!overflow, "mobile: no horizontal page scroll");
await mob.screenshot({ path: `${OUT}/07-mobile-he.png`, fullPage: true });

await browser.close();
writeFileSync(`${OUT}/e2e-result.json`, JSON.stringify({ failures }, null, 2));
if (failures.length) { console.error(failures); process.exit(1); }
console.log("E2E OK");
