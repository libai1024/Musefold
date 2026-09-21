CREATE TABLE "account_recovery_backup_evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"target_user_id" text NOT NULL,
	"upstream_issuer" text NOT NULL,
	"source_profile_id" text NOT NULL,
	"source_digest" text NOT NULL,
	"provenance" jsonb NOT NULL,
	"ciphertext" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"lease_id" text,
	"lease_until" timestamp with time zone,
	"state" text DEFAULT 'staged' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_recovery_backup_evidence_request_id_unique" UNIQUE("request_id"),
	CONSTRAINT "account_recovery_backup_state_check" CHECK ("account_recovery_backup_evidence"."state" IN ('staged','consumed','revoked')),
	CONSTRAINT "account_recovery_backup_revision_check" CHECK ("account_recovery_backup_evidence"."revision" > 0),
	CONSTRAINT "account_recovery_backup_digest_check" CHECK ("account_recovery_backup_evidence"."source_digest" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "account_recovery_backup_secret_check" CHECK ("account_recovery_backup_evidence"."state" = 'staged' OR "account_recovery_backup_evidence"."ciphertext" = '')
);
--> statement-breakpoint
ALTER TABLE "account_recovery_backup_evidence" ADD CONSTRAINT "account_recovery_backup_evidence_request_id_account_recovery_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."account_recovery_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_recovery_backup_expiry_idx" ON "account_recovery_backup_evidence" USING btree ("expires_at","id") WHERE "account_recovery_backup_evidence"."state" = 'staged';--> statement-breakpoint
CREATE INDEX "account_recovery_request_expiry_idx" ON "account_recovery_requests" USING btree ("expires_at","id") WHERE "account_recovery_requests"."candidate_ciphertext" <> '';