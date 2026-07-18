import { calculateSha256 } from "@/lib/csv/checksum";
import { CsvImportError } from "@/lib/csv/errors";
import type { CsvSourceConfig, DownloadedCsv } from "@/lib/csv/types";

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

export async function downloadCsv(
  config: CsvSourceConfig,
  fetchImplementation: typeof fetch = fetch,
): Promise<DownloadedCsv> {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = config.maxBytes ?? DEFAULT_MAX_BYTES;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImplementation(config.url, {
      method: config.method ?? "GET",
      headers: config.headers,
      body: config.body,
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new CsvImportError(
        "DOWNLOAD_FAILED",
        `CSV download failed with HTTP ${response.status}`,
      );
    }

    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      throw new CsvImportError(
        "FILE_TOO_LARGE",
        `CSV exceeds the ${maxBytes} byte limit`,
      );
    }

    if (!response.body) {
      throw new CsvImportError("EMPTY_FILE", "CSV response body is empty");
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let byteLength = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      byteLength += value.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel();
        throw new CsvImportError(
          "FILE_TOO_LARGE",
          `CSV exceeds the ${maxBytes} byte limit`,
        );
      }
      chunks.push(value);
    }

    if (byteLength === 0) {
      throw new CsvImportError("EMPTY_FILE", "CSV response body is empty");
    }

    const bytes = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return {
      bytes,
      checksum: calculateSha256(bytes),
      contentType: response.headers.get("content-type"),
      byteLength,
    };
  } catch (error) {
    if (error instanceof CsvImportError) throw error;

    if (controller.signal.aborted) {
      throw new CsvImportError(
        "DOWNLOAD_TIMEOUT",
        `CSV download exceeded ${timeoutMs}ms`,
        { cause: error },
      );
    }

    throw new CsvImportError("DOWNLOAD_FAILED", "CSV download failed", {
      cause: error,
    });
  } finally {
    clearTimeout(timeout);
  }
}
