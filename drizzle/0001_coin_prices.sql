ALTER TABLE "workspaces" ADD COLUMN "coin_prices" jsonb;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "coin_prices_fetched_at" timestamp with time zone;