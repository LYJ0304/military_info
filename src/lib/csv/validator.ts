import { CsvImportError } from "@/lib/csv/errors";

export const REQUIRED_HEADERS = [
  "날짜",
  "조식",
  "조식열량",
  "중식",
  "중식열량",
  "석식",
  "석식열량",
  "증특식",
  "증특식열량",
  "열량합계",
] as const;

export function normalizeHeaders(headers: string[]): string[] {
  return headers.map((header, index) =>
    header
      .replace(index === 0 ? /^\uFEFF/ : /$^/, "")
      .trim(),
  );
}

export function validateHeaders(headers: string[]): void {
  const missing = REQUIRED_HEADERS.filter(
    (required) => !headers.includes(required),
  );

  if (missing.length > 0) {
    throw new CsvImportError(
      "INVALID_HEADERS",
      `CSV is missing required columns: ${missing.join(", ")}`,
    );
  }
}
