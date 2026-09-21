ALTER TABLE "design_scheme_text_calls" DROP CONSTRAINT "scheme_text_call_role";--> statement-breakpoint
ALTER TABLE "design_scheme_text_executions" ADD COLUMN "revision_base" jsonb;--> statement-breakpoint
ALTER TABLE "design_scheme_text_calls" ADD CONSTRAINT "scheme_text_call_role" CHECK ("design_scheme_text_calls"."role" IN ('analyst','compiler','reviser'));