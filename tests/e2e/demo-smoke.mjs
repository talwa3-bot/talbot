// Smoke test for the static single-file demo (no server). Usage: node tests/e2e/demo-smoke.mjs
import { chromium } from "playwright";
const file = new URL("../../dist-demo/ledgerlens-demo.html", import.meta.url).href;
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
const page = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const errors = []; page.on("pageerror", (e) => errors.push(e.message));
const as = async (i) => { if (await page.$("#logout:not([hidden])")) await page.click("#logout"); await page.click(`.user >> nth=${i}`); await page.waitForSelector("#nav a"); };
await page.goto(file); await page.waitForSelector(".user");
await as(0); // cfo
await page.fill("#q", "מה החריגה בהוצאות התפעול ברבעון הראשון?"); await page.click("#askb"); await page.waitForSelector("#answer table");
const ok1 = (await page.textContent("#answer")).includes("5.74");
await page.click("#answer tbody [data-ev]"); await page.waitForSelector("#drawer-body table"); await page.keyboard.press("Escape");
await as(3); await page.goto(file + "#close").catch(() => {}); // accountant
await page.waitForSelector("[data-save]");
for (const id of await page.$$eval("[data-save]", (x) => x.map((e) => e.dataset.save))) { await page.selectOption(`#s-${id}`, "done"); await page.fill(`#e-${id}`, "doc://x"); await page.click(`[data-save="${id}"]`); await page.waitForTimeout(150); }
await as(1); await page.evaluate(() => (location.hash = "#close")); await page.waitForSelector("[data-save]"); // controller
for (const id of await page.$$eval("[data-save]", (x) => x.map((e) => e.dataset.save))) if ((await page.inputValue(`#s-${id}`)) !== "done") { await page.selectOption(`#s-${id}`, "done"); await page.fill(`#e-${id}`, "doc://p"); await page.click(`[data-save="${id}"]`); await page.waitForTimeout(150); }
await page.click("#ready"); await page.waitForSelector("#draft:not([disabled])"); await page.click("#draft"); await page.waitForSelector("#reqap"); await page.click("#reqap"); await page.waitForSelector("[data-approve], .badge.warn");
await as(0); await page.evaluate(() => (location.hash = "#close")); await page.waitForSelector("[data-approve]"); await page.click("[data-approve]"); await page.waitForSelector("[data-csv]");
await page.click("[data-csv]"); await page.waitForSelector("#txt"); const ok2 = (await page.textContent("#txt")).includes("department"); await page.keyboard.press("Escape");
await page.evaluate(() => (location.hash = "#explore")); await page.waitForSelector("#calc"); await page.click("#calc"); await page.waitForSelector("#scres table");
await page.screenshot({ path: "dist-demo/smoke.png", fullPage: true });
console.log({ answer: ok1, export: ok2, errors });
await b.close();
if (!ok1 || !ok2 || errors.length) process.exit(1);
