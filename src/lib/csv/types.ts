import type { MealType } from "@/lib/db/schema";

export interface CsvSourceConfig {
  source: string;
  url: string;
  method?: "GET" | "POST";
  headers?: HeadersInit;
  body?: BodyInit;
  timeoutMs?: number;
  maxBytes?: number;
}

export interface DownloadedCsv {
  bytes: Uint8Array;
  checksum: string;
  contentType: string | null;
  byteLength: number;
}

export interface ParsedMenuItem {
  mealType: MealType;
  menuName: string;
  calories: string | null;
  rawCalories: string;
}

export interface ParsedMenuRow {
  rowNumber: number;
  mealDate: string;
  items: ParsedMenuItem[];
  totalCalories: string | null;
  rawTotalCalories: string;
}

export interface CsvRowError {
  rowNumber: number;
  field: string;
  value: string;
  message: string;
}

export interface CsvParseResult {
  totalRows: number;
  validRows: ParsedMenuRow[];
  errors: CsvRowError[];
}
