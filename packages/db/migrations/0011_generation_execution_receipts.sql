CREATE TABLE "generation_execution_receipts" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"principal_id" text NOT NULL,
	"idempotency_key" varchar(160) NOT NULL,
	"operation" text NOT NULL,
	"original_run_id" varchar(64) NOT NULL,
	"source_run_id" varchar(64),
	"binding" jsonb,
	"binding_state" text NOT NULL,
	"logical_input_digest" varchar(64),
	"final_request_digest" varchar(64),
	"authorizing_session_id" text,
	"auth_revision" integer,
	"status" text NOT NULL,
	"dispatch" text DEFAULT 'not_started' NOT NULL,
	"cost_provenance" text DEFAULT 'not_sent' NOT NULL,
	"cost_points" integer,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"terminal_at" timestamp with time zone,
	"purged_at" timestamp with time zone,
	CONSTRAINT "generation_execution_receipts_principal_key_unique" UNIQUE("principal_id","idempotency_key"),
	CONSTRAINT "generation_execution_receipts_id_principal_unique" UNIQUE("id","principal_id"),
	CONSTRAINT "generation_execution_receipts_original_run_unique" UNIQUE("original_run_id"),
	CONSTRAINT "generation_execution_receipts_operation_check" CHECK ("generation_execution_receipts"."operation" IN ('ordinary_create','explicit_retry','scheme_run','legacy_unknown') AND ("generation_execution_receipts"."operation" <> 'legacy_unknown' OR "generation_execution_receipts"."binding_state" = 'legacy_unbound')),
	CONSTRAINT "generation_execution_receipts_binding_state_check" CHECK ("generation_execution_receipts"."binding_state" IN ('bound','legacy_unbound')),
	CONSTRAINT "generation_execution_receipts_binding_check" CHECK (("generation_execution_receipts"."binding_state" = 'legacy_unbound' AND "generation_execution_receipts"."binding" IS NULL AND "generation_execution_receipts"."authorizing_session_id" IS NULL AND "generation_execution_receipts"."auth_revision" IS NULL) OR ("generation_execution_receipts"."binding_state" = 'bound' AND "generation_execution_receipts"."binding" IS NOT NULL AND "generation_execution_receipts"."binding"->>'principalId' IS NOT NULL AND "generation_execution_receipts"."binding"->>'principalId' = "generation_execution_receipts"."principal_id" AND "generation_execution_receipts"."authorizing_session_id" IS NOT NULL AND "generation_execution_receipts"."auth_revision" IS NOT NULL AND "generation_execution_receipts"."auth_revision" > 0 AND "generation_execution_receipts"."logical_input_digest" IS NOT NULL AND "generation_execution_receipts"."final_request_digest" IS NOT NULL)),
	CONSTRAINT "generation_execution_receipts_digest_check" CHECK (("generation_execution_receipts"."logical_input_digest" IS NULL OR "generation_execution_receipts"."logical_input_digest" ~ '^[a-f0-9]{64}$') AND ("generation_execution_receipts"."final_request_digest" IS NULL OR "generation_execution_receipts"."final_request_digest" ~ '^[a-f0-9]{64}$')),
	CONSTRAINT "generation_execution_receipts_status_check" CHECK ("generation_execution_receipts"."status" IN ('queued','pending_approval','running','cancelling','succeeded','failed','cancelled','rejected','expired')),
	CONSTRAINT "generation_execution_receipts_dispatch_check" CHECK ("generation_execution_receipts"."dispatch" IN ('not_started','claimed','confirmed_not_sent')),
	CONSTRAINT "generation_execution_receipts_cost_provenance_check" CHECK ("generation_execution_receipts"."cost_provenance" IN ('not_sent','unknown','provider_reported')),
	CONSTRAINT "generation_execution_receipts_cost_check" CHECK (("generation_execution_receipts"."cost_points" IS NULL OR "generation_execution_receipts"."cost_points" >= 0) AND ("generation_execution_receipts"."cost_provenance" <> 'unknown' OR "generation_execution_receipts"."cost_points" IS NULL) AND ("generation_execution_receipts"."cost_provenance" <> 'not_sent' OR "generation_execution_receipts"."cost_points" IS NULL OR "generation_execution_receipts"."cost_points" = 0) AND ("generation_execution_receipts"."cost_provenance" <> 'provider_reported' OR "generation_execution_receipts"."cost_points" IS NOT NULL)),
	CONSTRAINT "generation_execution_receipts_revision_check" CHECK ("generation_execution_receipts"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "generation_runs" ADD COLUMN "execution_receipt_id" varchar(64);--> statement-breakpoint
CREATE INDEX "generation_execution_receipts_principal_created_idx" ON "generation_execution_receipts" USING btree ("principal_id","created_at");--> statement-breakpoint
ALTER TABLE "generation_runs" ADD CONSTRAINT "generation_runs_receipt_principal_fk" FOREIGN KEY ("execution_receipt_id","user_id") REFERENCES "public"."generation_execution_receipts"("id","principal_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "generation_runs_receipt_unique" ON "generation_runs" USING btree ("execution_receipt_id");
--> statement-breakpoint
-- Preserve old keys without inventing a payer, a normal BA session or a verified bill.
-- The run ID is already globally unique; reusing it keeps this backfill deterministic.
INSERT INTO "generation_execution_receipts" (
  "id", "principal_id", "idempotency_key", "operation", "original_run_id", "source_run_id",
  "binding_state", "status", "dispatch", "cost_provenance", "cost_points",
  "created_at", "updated_at", "terminal_at"
)
SELECT
  r."id", r."user_id", r."idempotency_key",
  CASE WHEN r."design_scheme_run_id" IS NOT NULL THEN 'scheme_run'
       WHEN r."run_kind" = 'retry' THEN 'legacy_unknown'
       ELSE 'ordinary_create' END,
  r."id", CASE WHEN r."design_scheme_run_id" IS NULL AND r."run_kind" = 'retry'
               THEN r."parent_run_id" ELSE NULL END,
  'legacy_unbound', r."status",
  CASE WHEN r."upstream_request_sent" OR r."status" = 'succeeded' THEN 'claimed'
       ELSE 'not_started' END,
  'unknown', NULL, r."created_at", r."created_at", r."finished_at"
FROM "generation_runs" r
WHERE r."idempotency_key" IS NOT NULL;
--> statement-breakpoint
UPDATE "generation_runs" r
SET "execution_receipt_id" = e."id"
FROM "generation_execution_receipts" e
WHERE e."original_run_id" = r."id" AND e."principal_id" = r."user_id";
