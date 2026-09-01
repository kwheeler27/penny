CREATE TYPE "public"."auction_security_type" AS ENUM('Bill', 'Note', 'Bond', 'TIPS', 'FRN', 'CMB');--> statement-breakpoint
CREATE TYPE "public"."auction_status" AS ENUM('announced', 'resulted');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auction" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "auction_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"cusip" text NOT NULL,
	"security_type" "auction_security_type" NOT NULL,
	"security_term" text NOT NULL,
	"original_security_term" text NOT NULL,
	"auction_date" date NOT NULL,
	"issue_date" date NOT NULL,
	"announcement_date" date NOT NULL,
	"offering_amount" numeric(20, 2),
	"total_accepted" numeric(20, 2),
	"bid_to_cover" numeric(12, 6),
	"high_yield" numeric(12, 6),
	"high_discount_rate" numeric(12, 6),
	"high_discount_margin" numeric(12, 6),
	"primary_dealer_accepted" numeric(20, 2),
	"direct_bidder_accepted" numeric(20, 2),
	"indirect_bidder_accepted" numeric(20, 2),
	"noncompetitive_accepted" numeric(20, 2),
	"soma_accepted" numeric(20, 2),
	"status" "auction_status" NOT NULL,
	"source_url" text NOT NULL,
	"publication_time" timestamp with time zone NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "auction_identity" ON "auction" USING btree ("cusip","auction_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auction_family_term_idx" ON "auction" USING btree ("security_type","original_security_term","auction_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auction_family_security_term_idx" ON "auction" USING btree ("security_type","security_term","auction_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auction_status_date_idx" ON "auction" USING btree ("status","auction_date");