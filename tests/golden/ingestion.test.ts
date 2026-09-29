import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { readCsv, readXlsx, suggestMapping, applyMapping, parseAmountMinor, actualsTemplateCsv, csvSafeCell } from "@ledgerlens/adapters";

describe("amounts", () => {
  it("parses to minor units without floats", () => {
    expect(parseAmountMinor("12,000.00")).toBe(1200000n);
    expect(parseAmountMinor("(500.00)")).toBe(-50000n);
    expect(parseAmountMinor("0.1")).toBe(10n);
    expect(parseAmountMinor("-7")).toBe(-700n);
  });
  it("rejects garbage and excess precision", () => {
    expect(() => parseAmountMinor("12.345")).toThrow();
    expect(() => parseAmountMinor("abc")).toThrow();
    expect(() => parseAmountMinor("")).toThrow();
  });
});

describe("CSV", () => {
  it("template round-trips and maps with no manual steps", () => {
    const t = readCsv(actualsTemplateCsv());
    const { mapping, unmapped } = suggestMapping(t.headers);
    expect(unmapped).toEqual([]);
    expect(applyMapping(t.rows[0]!, mapping).amount).toBe("12000.00");
  });
  it("handles BOM and Hebrew headers", () => {
    const t = readCsv("﻿מזהה,חודש,חברה,מחלקה,חשבון,סכום,מטבע\n1,2026-01,e1,מכירות,6000,100.50,ILS\n");
    const { mapping, unmapped } = suggestMapping(t.headers);
    expect(unmapped).toEqual([]);
    expect(applyMapping(t.rows[0]!, mapping).department).toBe("מכירות");
  });
  it("reports unmapped required columns instead of guessing", () => {
    expect(suggestMapping(["foo", "bar"]).unmapped).toContain("amount");
  });
  it("csvSafeCell neutralizes formula injection", () => {
    expect(csvSafeCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvSafeCell("plain")).toBe("plain");
  });
});

describe("XLSX", () => {
  it("reads a workbook; formulas use cached result only", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Actuals");
    ws.addRow(["source_row_id", "period", "entity_id", "department", "account", "amount", "currency"]);
    ws.addRow(["1", "2026-01", "e1", "sales", "6000", 12000, "USD"]);
    ws.addRow(["2", "2026-01", "e1", "ops", "6100", { formula: "7000+500", result: 7500 }, "USD"]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const t = await readXlsx(buf, "Actuals");
    expect(t.rows).toHaveLength(2);
    expect(parseAmountMinor(t.rows[1]!.amount!)).toBe(750000n);
  });
});
