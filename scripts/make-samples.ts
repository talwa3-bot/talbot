// Builds samples/04-actuals-ytd-2026.xlsx from the CSV so both formats carry identical data.
import ExcelJS from "exceljs";
import { readFileSync } from "node:fs";

const lines = readFileSync("samples/01-actuals-ytd-2026.csv", "utf8").replace(/^﻿/, "").trim().split("\n").map((l) => l.split(","));
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet("תנועות");
ws.views = [{ rightToLeft: true }];
ws.addRow(lines[0]);
for (const r of lines.slice(1)) {
  const amount = Number(r[5]);
  // One cell is a formula, as in real exports; the import reads its cached result only.
  const cell = r[0] === "GL-2026-0010" ? { formula: "9000+800", result: amount } : amount;
  ws.addRow([r[0], r[1], r[2], r[3], r[4], cell, r[6]]);
}
ws.getColumn(6).numFmt = "#,##0.00";
ws.columns.forEach((c) => (c.width = 16));
const sum = wb.addWorksheet("סיכום");
sum.views = [{ rightToLeft: true }];
sum.addRow(["סכום בקרה (הקלידו אותו בשדה סכום הבקרה)", { formula: `SUM('תנועות'!F2:F${lines.length})`, result: 416601.25 }]);
sum.getColumn(1).width = 44; sum.getColumn(2).numFmt = "#,##0.00"; sum.getColumn(2).width = 16;
await wb.xlsx.writeFile("samples/04-actuals-ytd-2026.xlsx");
console.log("samples/04-actuals-ytd-2026.xlsx");
