CREATE TYPE "public"."import_status" AS ENUM('PROCESSING', 'COMPLETED', 'FAILED', 'SKIPPED', 'PARTIALLY_COMPLETED');--> statement-breakpoint
CREATE TYPE "public"."meal_type" AS ENUM('BREAKFAST', 'LUNCH', 'DINNER', 'SPECIAL');--> statement-breakpoint
CREATE TABLE "daily_menu_summaries" (
	"source" text NOT NULL,
	"meal_date" date NOT NULL,
	"total_calories" numeric(10, 2),
	"raw_total_calories" text DEFAULT '' NOT NULL,
	"last_seen_run_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_menu_summaries_source_meal_date_pk" PRIMARY KEY("source","meal_date")
);
--> statement-breakpoint
CREATE TABLE "import_files" (
	"source" text NOT NULL,
	"checksum" text NOT NULL,
	"status" "import_status" NOT NULL,
	"run_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "import_files_source_checksum_pk" PRIMARY KEY("source","checksum")
);
--> statement-breakpoint
CREATE TABLE "import_locks" (
	"source" text PRIMARY KEY NOT NULL,
	"owner_run_id" uuid NOT NULL,
	"locked_until" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"checksum" text,
	"status" "import_status" NOT NULL,
	"total_rows" integer,
	"imported_rows" integer,
	"failed_rows" integer,
	"error_message" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "menu_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"meal_date" date NOT NULL,
	"meal_type" "meal_type" NOT NULL,
	"menu_name" text NOT NULL,
	"calories" numeric(10, 2),
	"raw_calories" text DEFAULT '' NOT NULL,
	"last_seen_run_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "daily_menu_summaries" ADD CONSTRAINT "daily_menu_summaries_last_seen_run_id_import_runs_id_fk" FOREIGN KEY ("last_seen_run_id") REFERENCES "public"."import_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_files" ADD CONSTRAINT "import_files_run_id_import_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."import_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_locks" ADD CONSTRAINT "import_locks_owner_run_id_import_runs_id_fk" FOREIGN KEY ("owner_run_id") REFERENCES "public"."import_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_last_seen_run_id_import_runs_id_fk" FOREIGN KEY ("last_seen_run_id") REFERENCES "public"."import_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "daily_menu_summaries_date_idx" ON "daily_menu_summaries" USING btree ("meal_date");--> statement-breakpoint
CREATE INDEX "import_runs_source_started_at_idx" ON "import_runs" USING btree ("source","started_at");--> statement-breakpoint
CREATE INDEX "import_runs_status_idx" ON "import_runs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "menu_items_business_key_uidx" ON "menu_items" USING btree ("source","meal_date","meal_type","menu_name","raw_calories");--> statement-breakpoint
CREATE INDEX "menu_items_date_type_idx" ON "menu_items" USING btree ("meal_date","meal_type");