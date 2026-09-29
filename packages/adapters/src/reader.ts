import { parse } from "csv-parse/sync";
import ExcelJS from "exceljs";

export interface Table { headers: string[]; rows: Record<string, string>[] }

export function readCsv(text: string): Table {
  const clean = text.replace(/^﻿/, ""); // Excel adds a BOM to UTF-8 CSVs
  const rows = parse(clean, { columns: true, skip_empty_lines: true, trim: true, relax_column_count: false }) as Record<string, string>[];
  const headers = rows[0] ? Object.keys(rows[0]) : (parse(clean, { to_line: 1 })[0] as string[] | undefined) ?? [];
  return { headers, rows };
}

export async function readXlsx(data: Buffer | ArrayBuffer, sheetName?: string): Promise<Table> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as ArrayBuffer);
  const ws = sheetName ? wb.getWorksheet(sheetName) : wb.worksheets[0];
  if (!ws) throw new Error("SHEET_NOT_FOUND");
  const headers: string[] = [];
  ws.getRow(1).eachCell((c, i) => { headers[i - 1] = cellText(c.value); });
  const rows: Record<string, string>[] = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const rec: Record<string, string> = {};
    headers.forEach((h, i) => { rec[h] = cellText(row.getCell(i + 1).value); });
    if (Object.values(rec).some((v) => v !== "")) rows.push(rec);
  });
  return { headers, rows };
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && "result" in v) return String(v.result ?? ""); // formula: cached result only
  if (v instanceof Date) return v.toISOString().slice(0, 7);
  if (typeof v === "object" && "text" in v) return String((v as { text: string }).text);
  return String(v);
}
