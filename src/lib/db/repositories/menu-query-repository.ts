import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  type SQL,
} from "drizzle-orm";

import { type Database, getDb } from "@/lib/db/client";
import {
  importRuns,
  type ImportStatus,
  menuItems,
} from "@/lib/db/schema";

export interface MenuPageQuery {
  source: string;
  page: number;
  pageSize: number;
  date?: string;
}

export interface ImportRunSummary {
  status: ImportStatus;
  startedAt: Date;
  completedAt: Date | null;
}

export interface MenuPageResult {
  items: Array<{
    id: string;
    mealDate: string;
    mealType: "BREAKFAST" | "LUNCH" | "DINNER" | "SPECIAL";
    menuName: string;
    calories: string | null;
    rawCalories: string;
  }>;
  total: number;
  latestRun: ImportRunSummary | null;
  lastSuccessfulImportAt: Date | null;
}

export interface MenuQueryStore {
  getMenuPage(query: MenuPageQuery): Promise<MenuPageResult>;
}

export class MenuQueryRepository implements MenuQueryStore {
  constructor(private readonly db: Database = getDb()) {}

  async getMenuPage(query: MenuPageQuery): Promise<MenuPageResult> {
    const conditions: SQL[] = [eq(menuItems.source, query.source)];
    if (query.date) {
      conditions.push(eq(menuItems.mealDate, query.date));
    }
    const where = and(...conditions);

    const [items, totalResult, latestRuns, successfulRuns] = await Promise.all([
      this.db
        .select({
          id: menuItems.id,
          mealDate: menuItems.mealDate,
          mealType: menuItems.mealType,
          menuName: menuItems.menuName,
          calories: menuItems.calories,
          rawCalories: menuItems.rawCalories,
        })
        .from(menuItems)
        .where(where)
        .orderBy(
          desc(menuItems.mealDate),
          asc(menuItems.mealType),
          asc(menuItems.menuName),
        )
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db
        .select({ value: count() })
        .from(menuItems)
        .where(where),
      this.db
        .select({
          status: importRuns.status,
          startedAt: importRuns.startedAt,
          completedAt: importRuns.completedAt,
        })
        .from(importRuns)
        .where(eq(importRuns.source, query.source))
        .orderBy(desc(importRuns.startedAt))
        .limit(1),
      this.db
        .select({ completedAt: importRuns.completedAt })
        .from(importRuns)
        .where(
          and(
            eq(importRuns.source, query.source),
            inArray(importRuns.status, [
              "COMPLETED",
              "PARTIALLY_COMPLETED",
            ]),
          ),
        )
        .orderBy(desc(importRuns.completedAt))
        .limit(1),
    ]);

    return {
      items,
      total: totalResult[0]?.value ?? 0,
      latestRun: latestRuns[0] ?? null,
      lastSuccessfulImportAt: successfulRuns[0]?.completedAt ?? null,
    };
  }
}
