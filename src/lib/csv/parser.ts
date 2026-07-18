import { parse } from "csv-parse/sync";

import { CsvImportError } from "@/lib/csv/errors";
import type {
  CsvParseResult,
  CsvRowError,
  ParsedMenuItem,
} from "@/lib/csv/types";
import {
  normalizeHeaders,
  REQUIRED_HEADERS,
  validateHeaders,
} from "@/lib/csv/validator";
import type { MealType } from "@/lib/db/schema";

type RequiredHeader = (typeof REQUIRED_HEADERS)[number];
type RawMenuRow = Record<RequiredHeader, string>;

const mealColumns: Array<{
  mealType: MealType;
  menu: RequiredHeader;
  calories: RequiredHeader;
}> = [
  { mealType: "BREAKFAST", menu: "조식", calories: "조식열량" },
  { mealType: "LUNCH", menu: "중식", calories: "중식열량" },
  { mealType: "DINNER", menu: "석식", calories: "석식열량" },
  { mealType: "SPECIAL", menu: "증특식", calories: "증특식열량" },
];

function parseDate(value: string): string | null {
  const match = value
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})(?:\([^)]*\))?$/);
  if (!match) return null;

  const [, year, month, day] = match;
  const parsed = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day)),
  );

  if (
    parsed.getUTCFullYear() !== Number(year) ||
    parsed.getUTCMonth() + 1 !== Number(month) ||
    parsed.getUTCDate() !== Number(day)
  ) {
    return null;
  }

  return `${year}-${month}-${day}`;
}

function parseCalories(value: string): string | null | undefined {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*kcal$/i);
  return match?.[1];
}

export function parseMenuCsv(csvText: string): CsvParseResult {
  if (!csvText.trim()) {
    throw new CsvImportError("EMPTY_FILE", "CSV content is empty");
  }

  let records: RawMenuRow[];
  try {
    records = parse(csvText, {
      bom: true,
      columns: (headers: string[]) => {
        const normalized = normalizeHeaders(headers);
        validateHeaders(normalized);
        return normalized;
      },
      skip_empty_lines: true,
      relax_column_count: false,
    }) as RawMenuRow[];
  } catch (error) {
    if (error instanceof CsvImportError) throw error;
    throw new CsvImportError("INVALID_CSV", "CSV syntax is invalid", {
      cause: error,
    });
  }

  const validRows: CsvParseResult["validRows"] = [];
  const errors: CsvRowError[] = [];

  records.forEach((record, index) => {
    const rowNumber = index + 2;
    const mealDate = parseDate(record["날짜"] ?? "");
    const rowErrors: CsvRowError[] = [];

    if (!mealDate) {
      rowErrors.push({
        rowNumber,
        field: "날짜",
        value: record["날짜"] ?? "",
        message: "날짜는 YYYY-MM-DD 또는 YYYY-MM-DD(요일) 형식이어야 합니다",
      });
    }

    const items: ParsedMenuItem[] = [];
    for (const column of mealColumns) {
      const menuName = (record[column.menu] ?? "").trim();
      const rawCalories = (record[column.calories] ?? "").trim();

      if (!menuName && !rawCalories) continue;
      if (!menuName && rawCalories) {
        rowErrors.push({
          rowNumber,
          field: column.menu,
          value: menuName,
          message: "열량이 있으면 메뉴명도 필요합니다",
        });
        continue;
      }

      const calories = parseCalories(rawCalories);
      if (calories === undefined) {
        rowErrors.push({
          rowNumber,
          field: column.calories,
          value: rawCalories,
          message: "열량은 숫자와 kcal 단위로 입력해야 합니다",
        });
        continue;
      }

      items.push({
        mealType: column.mealType,
        menuName,
        calories,
        rawCalories,
      });
    }

    const rawTotalCalories = (record["열량합계"] ?? "").trim();
    const totalCalories = parseCalories(rawTotalCalories);
    if (totalCalories === undefined) {
      rowErrors.push({
        rowNumber,
        field: "열량합계",
        value: rawTotalCalories,
        message: "열량은 숫자와 kcal 단위로 입력해야 합니다",
      });
    }

    if (rowErrors.length > 0 || !mealDate) {
      errors.push(...rowErrors);
      return;
    }

    validRows.push({
      rowNumber,
      mealDate,
      items,
      totalCalories: totalCalories ?? null,
      rawTotalCalories,
    });
  });

  return {
    totalRows: records.length,
    validRows,
    errors,
  };
}
