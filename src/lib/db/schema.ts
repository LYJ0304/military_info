import {
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const importStatusEnum = pgEnum("import_status", [
  "PROCESSING",
  "COMPLETED",
  "FAILED",
  "SKIPPED",
  "PARTIALLY_COMPLETED",
]);

export const mealTypeEnum = pgEnum("meal_type", [
  "BREAKFAST",
  "LUNCH",
  "DINNER",
  "SPECIAL",
]);

export const importRuns = pgTable(
  "import_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    source: text("source").notNull(),
    checksum: text("checksum"),
    status: importStatusEnum("status").notNull(),
    totalRows: integer("total_rows"),
    importedRows: integer("imported_rows"),
    failedRows: integer("failed_rows"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("import_runs_source_started_at_idx").on(
      table.source,
      table.startedAt,
    ),
    index("import_runs_status_idx").on(table.status),
  ],
);

export const importFiles = pgTable(
  "import_files",
  {
    source: text("source").notNull(),
    checksum: text("checksum").notNull(),
    status: importStatusEnum("status").notNull(),
    runId: uuid("run_id")
      .notNull()
      .references(() => importRuns.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [primaryKey({ columns: [table.source, table.checksum] })],
);

export const importLocks = pgTable("import_locks", {
  source: text("source").primaryKey(),
  ownerRunId: uuid("owner_run_id")
    .notNull()
    .references(() => importRuns.id),
  lockedUntil: timestamp("locked_until", { withTimezone: true }).notNull(),
});

export const menuItems = pgTable(
  "menu_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    source: text("source").notNull(),
    mealDate: date("meal_date", { mode: "string" }).notNull(),
    mealType: mealTypeEnum("meal_type").notNull(),
    menuName: text("menu_name").notNull(),
    calories: numeric("calories", { precision: 10, scale: 2 }),
    rawCalories: text("raw_calories").default("").notNull(),
    lastSeenRunId: uuid("last_seen_run_id")
      .notNull()
      .references(() => importRuns.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("menu_items_business_key_uidx").on(
      table.source,
      table.mealDate,
      table.mealType,
      table.menuName,
      table.rawCalories,
    ),
    index("menu_items_date_type_idx").on(table.mealDate, table.mealType),
  ],
);

export const dailyMenuSummaries = pgTable(
  "daily_menu_summaries",
  {
    source: text("source").notNull(),
    mealDate: date("meal_date", { mode: "string" }).notNull(),
    totalCalories: numeric("total_calories", { precision: 10, scale: 2 }),
    rawTotalCalories: text("raw_total_calories").default("").notNull(),
    lastSeenRunId: uuid("last_seen_run_id")
      .notNull()
      .references(() => importRuns.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.source, table.mealDate] }),
    index("daily_menu_summaries_date_idx").on(table.mealDate),
  ],
);

export type ImportStatus = (typeof importStatusEnum.enumValues)[number];
export type MealType = (typeof mealTypeEnum.enumValues)[number];
export type NewMenuItem = typeof menuItems.$inferInsert;
export type NewDailyMenuSummary = typeof dailyMenuSummaries.$inferInsert;
