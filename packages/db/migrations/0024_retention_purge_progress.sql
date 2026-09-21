ALTER TABLE "prompts" ADD COLUMN "purge_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "generation_runs" ADD COLUMN "purge_started_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "prompt_usage_events_retention_idx" ON "prompt_usage_events" USING btree ("prompt_id","user_id","event_id");--> statement-breakpoint
CREATE INDEX "generation_assets_retention_idx" ON "generation_assets" USING btree ("run_id","id");--> statement-breakpoint
ALTER TABLE "prompts" ADD CONSTRAINT "prompts_purge_state_check" CHECK ("prompts"."purge_started_at" IS NULL OR "prompts"."deleted_at" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "generation_runs" ADD CONSTRAINT "generation_runs_purge_state_check" CHECK ("generation_runs"."purge_started_at" IS NULL OR ("generation_runs"."deleted_at" IS NOT NULL AND "generation_runs"."status" IN ('succeeded','failed','cancelled','rejected','expired')));
--> statement-breakpoint
-- A completed first batch is irreversible even for a stale API process.
CREATE FUNCTION retention_keep_purge_marker() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.purge_started_at IS NOT NULL AND
    (NEW.purge_started_at IS DISTINCT FROM OLD.purge_started_at OR NEW.deleted_at IS NULL OR
     NEW.id IS DISTINCT FROM OLD.id OR NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
    RAISE EXCEPTION 'retention purge is irreversible' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER generation_retention_marker BEFORE UPDATE ON generation_runs
FOR EACH ROW EXECUTE FUNCTION retention_keep_purge_marker();
--> statement-breakpoint
CREATE TRIGGER prompt_retention_marker BEFORE UPDATE ON prompts
FOR EACH ROW EXECUTE FUNCTION retention_keep_purge_marker();
--> statement-breakpoint
-- Serialize late child writers with the parent's first irreversible batch.
-- Table/column names are fixed trigger arguments, never user input.
CREATE FUNCTION retention_reject_late_child() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE marked timestamptz;
BEGIN
  EXECUTE format('SELECT purge_started_at FROM %I WHERE id=$1 FOR KEY SHARE', TG_ARGV[0])
    INTO marked USING to_jsonb(NEW)->>TG_ARGV[1];
  IF marked IS NOT NULL THEN
    RAISE EXCEPTION 'retention parent is permanently deleted' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER generation_assets_retention_parent BEFORE INSERT OR UPDATE ON generation_assets
FOR EACH ROW EXECUTE FUNCTION retention_reject_late_child('generation_runs','run_id');
--> statement-breakpoint
CREATE TRIGGER generation_events_retention_parent BEFORE INSERT OR UPDATE ON generation_events
FOR EACH ROW EXECUTE FUNCTION retention_reject_late_child('generation_runs','run_id');
--> statement-breakpoint
CREATE TRIGGER generation_reference_links_retention_parent BEFORE INSERT OR UPDATE ON generation_reference_links
FOR EACH ROW EXECUTE FUNCTION retention_reject_late_child('generation_runs','run_id');
--> statement-breakpoint
CREATE TRIGGER scheme_generation_references_retention_parent BEFORE INSERT OR UPDATE ON design_scheme_generation_references
FOR EACH ROW EXECUTE FUNCTION retention_reject_late_child('generation_runs','generation_run_id');
--> statement-breakpoint
CREATE TRIGGER prompt_tag_links_retention_parent BEFORE INSERT OR UPDATE ON prompt_tag_links
FOR EACH ROW EXECUTE FUNCTION retention_reject_late_child('prompts','prompt_id');
--> statement-breakpoint
CREATE TRIGGER prompt_usage_events_retention_parent BEFORE INSERT OR UPDATE ON prompt_usage_events
FOR EACH ROW EXECUTE FUNCTION retention_reject_late_child('prompts','prompt_id');
