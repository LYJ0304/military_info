import { and, desc, eq, lt, ne, or, sql } from "drizzle-orm";

import { type Database, getDb } from "@/lib/db/client";
import {
  dailyMenuSummaries,
  importFiles,
  importLocks,
  importRuns,
  type ImportStatus,
  menuItems,
  type NewDailyMenuSummary,
  type NewMenuItem,
} from "@/lib/db/schema";

export type FileClaimResult =
  | "CLAIMED"
  | "RETRY_CLAIMED"
  | "ALREADY_COMPLETED"
  | "IN_PROGRESS";

export interface CompleteRunInput {
  status: Exclude<ImportStatus, "PROCESSING">;
  totalRows: number;
  importedRows: number;
  failedRows: number;
  errorMessage?: string;
}

export class ImportRepository {
  constructor(private readonly db: Database = getDb()) {}

  async createRun(source: string, checksum?: string) {
    const [run] = await this.db
      .insert(importRuns)
      .values({ source, checksum, status: "PROCESSING" })
      .returning();

    if (!run) throw new Error("Failed to create import run");
    return run;
  }

  async setRunChecksum(runId: string, checksum: string): Promise<void> {
    await this.db
      .update(importRuns)
      .set({ checksum })
      .where(eq(importRuns.id, runId));
  }

  async finishRun(runId: string, input: CompleteRunInput): Promise<void> {
    await this.db
      .update(importRuns)
      .set({
        ...input,
        errorMessage: input.errorMessage?.slice(0, 2_000),
        completedAt: new Date(),
      })
      .where(eq(importRuns.id, runId));
  }

  async tryAcquireLock(
    source: string,
    ownerRunId: string,
    lockedUntil: Date,
  ): Promise<boolean> {
    const [lock] = await this.db
      .insert(importLocks)
      .values({ source, ownerRunId, lockedUntil })
      .onConflictDoUpdate({
        target: importLocks.source,
        set: { ownerRunId, lockedUntil },
        setWhere: lt(importLocks.lockedUntil, new Date()),
      })
      .returning({ ownerRunId: importLocks.ownerRunId });

    return lock?.ownerRunId === ownerRunId;
  }

  async releaseLock(source: string, ownerRunId: string): Promise<void> {
    await this.db
      .delete(importLocks)
      .where(
        and(
          eq(importLocks.source, source),
          eq(importLocks.ownerRunId, ownerRunId),
        ),
      );
  }

  async claimFile(
    source: string,
    checksum: string,
    runId: string,
  ): Promise<FileClaimResult> {
    const [existing] = await this.db
      .select({ status: importFiles.status })
      .from(importFiles)
      .where(
        and(eq(importFiles.source, source), eq(importFiles.checksum, checksum)),
      )
      .limit(1);

    if (!existing) {
      await this.db.insert(importFiles).values({
        source,
        checksum,
        runId,
        status: "PROCESSING",
      });
      return "CLAIMED";
    }

    if (
      existing.status === "COMPLETED" ||
      existing.status === "PARTIALLY_COMPLETED"
    ) {
      return "ALREADY_COMPLETED";
    }


    const [claimed] = await this.db
      .update(importFiles)
      .set({ status: "PROCESSING", runId, completedAt: null })
      .where(
        and(
          eq(importFiles.source, source),
          eq(importFiles.checksum, checksum),
          or(
            eq(importFiles.status, "FAILED"),
            eq(importFiles.status, "SKIPPED"),
            eq(importFiles.status, "PROCESSING"),
          ),
        ),
      )
      .returning({ runId: importFiles.runId });

    return claimed?.runId === runId ? "RETRY_CLAIMED" : "IN_PROGRESS";
  }

  async finishFile(
    source: string,
    checksum: string,
    runId: string,
    status: "COMPLETED" | "PARTIALLY_COMPLETED" | "FAILED",
  ): Promise<void> {
    await this.db
      .update(importFiles)
      .set({ status, completedAt: new Date() })
      .where(
        and(
          eq(importFiles.source, source),
          eq(importFiles.checksum, checksum),
          eq(importFiles.runId, runId),
        ),
      );
  }

  async upsertMenuItems(items: NewMenuItem[]): Promise<void> {
    if (items.length === 0) return;

    await this.db
      .insert(menuItems)
      .values(items)
      .onConflictDoUpdate({
        target: [
          menuItems.source,
          menuItems.mealDate,
          menuItems.mealType,
          menuItems.menuName,
          menuItems.rawCalories,
        ],
        set: {
          calories: sql`excluded.calories`,
          lastSeenRunId: sql`excluded.last_seen_run_id`,
          updatedAt: new Date(),
        },
      });
  }

  async upsertDailySummaries(
    summaries: NewDailyMenuSummary[],
  ): Promise<void> {
    if (summaries.length === 0) return;

    await this.db
      .insert(dailyMenuSummaries)
      .values(summaries)
      .onConflictDoUpdate({
        target: [dailyMenuSummaries.source, dailyMenuSummaries.mealDate],
        set: {
          totalCalories: sql`excluded.total_calories`,
          rawTotalCalories: sql`excluded.raw_total_calories`,
          lastSeenRunId: sql`excluded.last_seen_run_id`,
          updatedAt: new Date(),
        },
      });
  }

  async deleteStaleData(source: string, runId: string): Promise<void> {
    await this.db
      .delete(menuItems)
      .where(
        and(eq(menuItems.source, source), ne(menuItems.lastSeenRunId, runId)),
      );
    await this.db
      .delete(dailyMenuSummaries)
      .where(
        and(
          eq(dailyMenuSummaries.source, source),
          ne(dailyMenuSummaries.lastSeenRunId, runId),
        ),
      );
  }

  async getLatestRun(source: string) {
    const [run] = await this.db
      .select()
      .from(importRuns)
      .where(eq(importRuns.source, source))
      .orderBy(desc(importRuns.startedAt))
      .limit(1);

    return run;
  }
}
