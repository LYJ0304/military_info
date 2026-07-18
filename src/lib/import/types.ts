import type {
  NewDailyMenuSummary,
  NewMenuItem,
} from "@/lib/db/schema";
import type { CompleteRunInput, FileClaimResult } from "@/lib/db/repositories/import-repository";

export interface ImportRunRef {
  id: string;
}

export interface ImportStore {
  createRun(source: string, checksum?: string): Promise<ImportRunRef>;
  setRunChecksum(runId: string, checksum: string): Promise<void>;
  finishRun(runId: string, input: CompleteRunInput): Promise<void>;
  tryAcquireLock(
    source: string,
    ownerRunId: string,
    lockedUntil: Date,
  ): Promise<boolean>;
  releaseLock(source: string, ownerRunId: string): Promise<void>;
  claimFile(
    source: string,
    checksum: string,
    runId: string,
  ): Promise<FileClaimResult>;
  finishFile(
    source: string,
    checksum: string,
    runId: string,
    status: "COMPLETED" | "PARTIALLY_COMPLETED" | "FAILED",
  ): Promise<void>;
  upsertMenuItems(items: NewMenuItem[]): Promise<void>;
  upsertDailySummaries(
    summaries: NewDailyMenuSummary[],
  ): Promise<void>;
  deleteStaleData(source: string, runId: string): Promise<void>;
}

export interface MenuImportResult {
  runId: string;
  source: string;
  checksum?: string;
  status:
    | "COMPLETED"
    | "FAILED"
    | "SKIPPED"
    | "PARTIALLY_COMPLETED";
  totalRows: number;
  importedRows: number;
  failedRows: number;
  message?: string;
}

export class MenuImportExecutionError extends Error {
  constructor(
    message: string,
    public readonly result: MenuImportResult,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "MenuImportExecutionError";
  }
}
