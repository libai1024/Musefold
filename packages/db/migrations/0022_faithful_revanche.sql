ALTER TABLE "design_scheme_agent_sessions" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
-- Backfill the immutable original session creation time; legacy rows without it retain their last known timestamp.
UPDATE "design_scheme_agent_sessions"
SET "created_at" = COALESCE(("view"->>'createdAt')::timestamptz, "updated_at");
--> statement-breakpoint
CREATE INDEX "scheme_agent_history_idx" ON "design_scheme_agent_sessions" USING btree ("user_id","created_at" DESC NULLS LAST,"execution_id" DESC NULLS LAST);