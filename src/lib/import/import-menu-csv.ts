import { decodeCsv } from "@/lib/csv/decoder";
import { downloadCsv } from "@/lib/csv/downloader";
import { parseMenuCsv } from "@/lib/csv/parser";
import {
  getMndMenuSourceConfig,
  MND_MENU_SOURCE,
} from "@/lib/csv/sources/mnd-menu";
import type {
  CsvParseResult,
  CsvSourceConfig,
  DownloadedCsv,
} from "@/lib/csv/types";
import { ImportRepository } from "@/lib/db/repositories/import-repository";
import type {
  NewDailyMenuSummary,
  NewMenuItem,
} from "@/lib/db/schema";
import {
  type ImportStore,
  MenuImportExecutionError,
  type MenuImportResult,
} from "@/lib/import/types";

const BATCH_SIZE = 500;
const LOCK_DURATION_MS = 15 * 60 * 1_000;

interface MenuImportDependencies {
  repository: ImportStore;
  sourceConfig: CsvSourceConfig;
  download?: (config: CsvSourceConfig) => Promise<DownloadedCsv>;
  decode?: (bytes: Uint8Array) => string;
  parse?: (csvText: string) => CsvParseResult;
  now?: () => Date;
}

function batch<T>(values: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    batches.push(values.slice(index, index + size));
  }
  return batches;
}

function menuBusinessKey(item: NewMenuItem): string {
  return [
    item.source,
    item.mealDate,
    item.mealType,
    item.menuName,
    item.rawCalories,
  ].join("\u001f");
}

function prepareData(
  parsed: CsvParseResult,
  source: string,
  runId: string,
): {
  menuItems: NewMenuItem[];
  summaries: NewDailyMenuSummary[];
  failedRows: number;
  errorMessage?: string;
} {
  const uniqueItems = new Map<string, NewMenuItem>();
  const summaries = new Map<string, NewDailyMenuSummary>();

  for (const row of parsed.validRows) {
    for (const item of row.items) {
      const record: NewMenuItem = {
        source,
        mealDate: row.mealDate,
        mealType: item.mealType,
        menuName: item.menuName,
        calories: item.calories,
        rawCalories: item.rawCalories,
        lastSeenRunId: runId,
      };
      uniqueItems.set(menuBusinessKey(record), record);
    }

    summaries.set(row.mealDate, {
      source,
      mealDate: row.mealDate,
      totalCalories: row.totalCalories,
      rawTotalCalories: row.rawTotalCalories,
      lastSeenRunId: runId,
    });
  }

  const failedRowNumbers = [...new Set(parsed.errors.map((error) => error.rowNumber))];
  const errorSamples = parsed.errors
    .slice(0, 10)
    .map(
      (error) =>
        `row ${error.rowNumber} ${error.field}: ${error.message}`,
    );

  return {
    menuItems: [...uniqueItems.values()],
    summaries: [...summaries.values()],
    failedRows: failedRowNumbers.length,
    errorMessage:
      errorSamples.length > 0
        ? `${failedRowNumbers.length} row(s) rejected; ${errorSamples.join("; ")}`
        : undefined,
  };
}

async function recordFailure(
  repository: ImportStore,
  result: MenuImportResult,
  fileClaimed: boolean,
): Promise<void> {
  if (result.checksum && fileClaimed) {
    await repository
      .finishFile(
        result.source,
        result.checksum,
        result.runId,
        "FAILED",
      )
      .catch(() => undefined);
  }

  await repository
    .finishRun(result.runId, {
      status: "FAILED",
      totalRows: result.totalRows,
      importedRows: result.importedRows,
      failedRows: result.failedRows,
      errorMessage: result.message,
    })
    .catch(() => undefined);
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 500);
  return "Unknown import failure";
}

export async function importMenuCsv({
  repository,
  sourceConfig,
  download = downloadCsv,
  decode = decodeCsv,
  parse = parseMenuCsv,
  now = () => new Date(),
}: MenuImportDependencies): Promise<MenuImportResult> {
  const source = sourceConfig.source;
  const run = await repository.createRun(source);
  let lockAcquired = false;
  let fileClaimed = false;
  let result: MenuImportResult = {
    runId: run.id,
    source,
    status: "FAILED",
    totalRows: 0,
    importedRows: 0,
    failedRows: 0,
  };

  try {
    lockAcquired = await repository.tryAcquireLock(
      source,
      run.id,
      new Date(now().getTime() + LOCK_DURATION_MS),
    );

    if (!lockAcquired) {
      result = {
        ...result,
        status: "SKIPPED",
        message: "Another import for this source is already running",
      };
      await repository.finishRun(run.id, {
        status: "SKIPPED",
        totalRows: 0,
        importedRows: 0,
        failedRows: 0,
        errorMessage: result.message,
      });
      return result;
    }

    const downloaded = await download(sourceConfig);
    result.checksum = downloaded.checksum;
    await repository.setRunChecksum(run.id, downloaded.checksum);

    const claim = await repository.claimFile(
      source,
      downloaded.checksum,
      run.id,
    );

    if (claim === "ALREADY_COMPLETED") {
      result = {
        ...result,
        status: "SKIPPED",
        message: "This CSV checksum has already been processed",
      };
      await repository.finishRun(run.id, {
        status: "SKIPPED",
        totalRows: 0,
        importedRows: 0,
        failedRows: 0,
        errorMessage: result.message,
      });
      return result;
    }

    if (claim === "IN_PROGRESS") {
      result = {
        ...result,
        status: "SKIPPED",
        message: "This CSV checksum is being processed",
      };
      await repository.finishRun(run.id, {
        status: "SKIPPED",
        totalRows: 0,
        importedRows: 0,
        failedRows: 0,
        errorMessage: result.message,
      });
      return result;
    }

    fileClaimed = true;
    const parsed = parse(decode(downloaded.bytes));
    const prepared = prepareData(parsed, source, run.id);

    const completionStatus =
      prepared.failedRows > 0 ? "PARTIALLY_COMPLETED" : "COMPLETED";

    result = {
      ...result,
      status: completionStatus,
      totalRows: parsed.totalRows,
      importedRows: parsed.validRows.length,
      failedRows: prepared.failedRows,
      message: prepared.errorMessage,
    };

    for (const items of batch(prepared.menuItems, BATCH_SIZE)) {
      await repository.upsertMenuItems(items);
    }
    for (const summaries of batch(prepared.summaries, BATCH_SIZE)) {
      await repository.upsertDailySummaries(summaries);
    }

    if (result.status === "COMPLETED") {
      await repository.deleteStaleData(source, run.id);
    }

    await repository.finishFile(
      source,
      downloaded.checksum,
      run.id,
      completionStatus,
    );
    await repository.finishRun(run.id, {
      status: completionStatus,
      totalRows: result.totalRows,
      importedRows: result.importedRows,
      failedRows: result.failedRows,
      errorMessage: result.message,
    });

    return result;
  } catch (error) {
    result = {
      ...result,
      status: "FAILED",
      message: safeErrorMessage(error),
    };
    await recordFailure(repository, result, fileClaimed);
    throw new MenuImportExecutionError("Menu CSV import failed", result, {
      cause: error,
    });
  } finally {
    if (lockAcquired) {
      await repository.releaseLock(source, run.id).catch(() => undefined);
    }
  }
}

export function importMndMenuCsv(): Promise<MenuImportResult> {
  return importMenuCsv({
    repository: new ImportRepository(),
    sourceConfig: getMndMenuSourceConfig(),
  });
}

export { MND_MENU_SOURCE };
