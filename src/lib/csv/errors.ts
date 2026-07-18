export type CsvErrorCode =
  | "DOWNLOAD_FAILED"
  | "DOWNLOAD_TIMEOUT"
  | "EMPTY_FILE"
  | "FILE_TOO_LARGE"
  | "INVALID_ENCODING"
  | "INVALID_CSV"
  | "INVALID_HEADERS";

export class CsvImportError extends Error {
  constructor(
    public readonly code: CsvErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "CsvImportError";
  }
}
