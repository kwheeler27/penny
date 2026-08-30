CREATE TYPE "public"."accounting_concept" AS ENUM('receipt', 'outlay', 'deficit', 'debt', 'balance', 'interest', 'price_index', 'projection');--> statement-breakpoint
CREATE TYPE "public"."cadence" AS ENUM('daily', 'monthly', 'annual');--> statement-breakpoint
CREATE TYPE "public"."ingest_outcome" AS ENUM('success', 'partial', 'failure');--> statement-breakpoint
CREATE TYPE "public"."magnitude" AS ENUM('ones', 'thousands', 'millions', 'billions');--> statement-breakpoint
CREATE TYPE "public"."period_type" AS ENUM('day', 'month', 'fiscal_ytd', 'year');--> statement-breakpoint
CREATE TYPE "public"."unit" AS ENUM('usd', 'index_point');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ingest_run" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ingest_run_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"job" text NOT NULL,
	"source_url" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"row_count" integer,
	"outcome" "ingest_outcome",
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "observation" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "observation_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"series_id" text NOT NULL,
	"period_type" "period_type" NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"fiscal_year" integer,
	"value" numeric(20, 4) NOT NULL,
	"publication_time" timestamp with time zone NOT NULL,
	"revision_of" integer,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "series" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"definition" text NOT NULL,
	"agency" text NOT NULL,
	"dataset" text NOT NULL,
	"dataset_url" text NOT NULL,
	"citation" text NOT NULL,
	"unit" "unit" NOT NULL,
	"magnitude" "magnitude" NOT NULL,
	"accounting_concept" "accounting_concept" NOT NULL,
	"cadence" "cadence" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "observation" ADD CONSTRAINT "observation_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "observation_identity" ON "observation" USING btree ("series_id","period_type","period_end","publication_time");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "observation_series_period_idx" ON "observation" USING btree ("series_id","period_type","period_end");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "observation_revision_of_idx" ON "observation" USING btree ("revision_of");