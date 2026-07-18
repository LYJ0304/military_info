import { CsvImportError } from "@/lib/csv/errors";

const decoders = [
  new TextDecoder("utf-8", { fatal: true }),
  new TextDecoder("euc-kr", { fatal: true }),
];

export function decodeCsv(bytes: Uint8Array): string {
  for (const decoder of decoders) {
    try {
      return decoder.decode(bytes).replace(/^\uFEFF/, "");
    } catch {
      // Try the next supported encoding.
    }
  }

  throw new CsvImportError(
    "INVALID_ENCODING",
    "CSV must be UTF-8 or CP949/EUC-KR encoded",
  );
}
