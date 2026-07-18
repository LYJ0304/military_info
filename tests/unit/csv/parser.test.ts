import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { CsvImportError } from "@/lib/csv/errors";
import { parseMenuCsv } from "@/lib/csv/parser";

function fixture(name: string): string {
  return readFileSync(resolve("tests/fixtures", name), "utf8");
}

describe("parseMenuCsv", () => {
  it("parses a valid CSV and normalizes weekday dates", () => {
    const result = parseMenuCsv(fixture("valid-sample.csv"));

    expect(result.totalRows).toBe(2);
    expect(result.validRows).toHaveLength(2);
    expect(result.validRows[0].mealDate).toBe("2026-05-01");
    expect(result.validRows[0].items[1]).toMatchObject({
      mealType: "LUNCH",
      menuName: "소고기, 채소볶음",
      calories: "412.5",
    });
    expect(result.errors).toEqual([]);
  });

  it("accepts a UTF-8 BOM", () => {
    const result = parseMenuCsv(`\uFEFF${fixture("valid-sample.csv")}`);

    expect(result.validRows).toHaveLength(2);
  });

  it("rejects missing required columns", () => {
    expect(() => parseMenuCsv(fixture("invalid-columns.csv"))).toThrowError(
      CsvImportError,
    );

    try {
      parseMenuCsv(fixture("invalid-columns.csv"));
    } catch (error) {
      expect(error).toMatchObject({ code: "INVALID_HEADERS" });
    }
  });

  it("preserves a comma inside a quoted field", () => {
    const result = parseMenuCsv(fixture("valid-sample.csv"));

    expect(result.validRows[0].items[1].menuName).toBe("소고기, 채소볶음");
  });

  it("collects invalid date and calorie row errors", () => {
    const result = parseMenuCsv(fixture("malformed-row.csv"));

    expect(result.totalRows).toBe(2);
    expect(result.validRows).toHaveLength(0);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "날짜", value: "2026-02-30" }),
        expect.objectContaining({ field: "조식열량", value: "175ml" }),
      ]),
    );
  });

  it("rejects an empty CSV", () => {
    expect(() => parseMenuCsv(" \n")).toThrowError(
      expect.objectContaining({ code: "EMPTY_FILE" }),
    );
  });
});
