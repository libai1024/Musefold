ALTER TABLE "object_inventory_candidates" ADD COLUMN "claim_token" varchar(64);--> statement-breakpoint
ALTER TABLE "object_inventory_candidates" ADD COLUMN "claim_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "object_inventory_candidates" ADD COLUMN "attempt_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "object_inventory_candidates" ADD COLUMN "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "object_inventory_candidates" ADD COLUMN "last_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "object_inventory_candidates" ADD COLUMN "last_error" varchar(64);--> statement-breakpoint
ALTER TABLE "object_inventory_candidates" ADD COLUMN "abandoned_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "object_inventory_candidates_ready_idx" ON "object_inventory_candidates" USING btree ("scope_id","abandoned_at","next_attempt_at","eligible_at");--> statement-breakpoint
ALTER TABLE "object_inventory_candidates" ADD CONSTRAINT "object_inventory_attempt_check" CHECK ("object_inventory_candidates"."attempt_count" >= 0);--> statement-breakpoint
ALTER TABLE "object_inventory_candidates" ADD CONSTRAINT "object_inventory_claim_check" CHECK (("object_inventory_candidates"."claim_token" IS NULL) = ("object_inventory_candidates"."claim_until" IS NULL));