CREATE TABLE "account_identities" (
	"user_id" text PRIMARY KEY NOT NULL,
	"api_issuer" text,
	"upstream_issuer" text,
	"upstream_owner_id" text,
	"status" text DEFAULT 'unverified' NOT NULL,
	"identity_version" integer DEFAULT 0 NOT NULL,
	"verified_at" timestamp with time zone,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_identity_status_check" CHECK ("account_identities"."status" IN ('unverified','active','verification_pending','identity_conflict','recovery_required')),
	CONSTRAINT "account_identity_version_check" CHECK ("account_identities"."identity_version" >= 0),
	CONSTRAINT "account_identity_active_source_check" CHECK ("account_identities"."status" <> 'active' OR ("account_identities"."api_issuer" IS NOT NULL AND "account_identities"."upstream_issuer" IS NOT NULL AND "account_identities"."upstream_owner_id" IS NOT NULL AND "account_identities"."verified_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "account_recovery_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"target_user_id" text NOT NULL,
	"upstream_issuer" text NOT NULL,
	"upstream_owner_id" text NOT NULL,
	"candidate_ciphertext" text NOT NULL,
	"candidate_summary" jsonb NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"identity_version" integer NOT NULL,
	"completed_user_id" text,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_recovery_requests_session_id_unique" UNIQUE("session_id"),
	CONSTRAINT "account_recovery_reason_check" CHECK ("account_recovery_requests"."reason" IN ('legacy_issuer_unknown','legacy_evidence_missing','legacy_identity_conflict','verification_pending')),
	CONSTRAINT "account_recovery_status_check" CHECK ("account_recovery_requests"."status" IN ('pending','completed'))
);
--> statement-breakpoint
CREATE TABLE "account_session_authorizations" (
	"session_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"mode" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_session_mode_check" CHECK ("account_session_authorizations"."mode" IN ('normal','recovery_only'))
);
--> statement-breakpoint
ALTER TABLE "account_credentials" ADD COLUMN "upstream_issuer" text;--> statement-breakpoint
ALTER TABLE "account_credentials" ADD COLUMN "upstream_owner_id" text;--> statement-breakpoint
ALTER TABLE "account_credentials" ADD COLUMN "credential_ref" text;--> statement-breakpoint
ALTER TABLE "account_credentials" ADD COLUMN "credential_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "account_credentials" ADD COLUMN "status" text DEFAULT 'unverified' NOT NULL;--> statement-breakpoint
ALTER TABLE "account_credentials" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "relay_sessions" ADD COLUMN "upstream_issuer" text;--> statement-breakpoint
ALTER TABLE "relay_sessions" ADD COLUMN "upstream_owner_id" text;--> statement-breakpoint
ALTER TABLE "relay_sessions" ADD COLUMN "revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "relay_sessions" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "relay_sessions" ADD COLUMN "refresh_lease_id" text;--> statement-breakpoint
ALTER TABLE "relay_sessions" ADD COLUMN "refresh_lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "account_identities" ADD CONSTRAINT "account_identities_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_recovery_requests" ADD CONSTRAINT "account_recovery_requests_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_recovery_requests" ADD CONSTRAINT "account_recovery_requests_target_user_id_user_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_recovery_requests" ADD CONSTRAINT "account_recovery_requests_completed_user_id_user_id_fk" FOREIGN KEY ("completed_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_session_authorizations" ADD CONSTRAINT "account_session_authorizations_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_session_authorizations" ADD CONSTRAINT "account_session_authorizations_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_identity_issuer_owner_unique" ON "account_identities" USING btree ("upstream_issuer","upstream_owner_id");--> statement-breakpoint
ALTER TABLE "account_credentials" ADD CONSTRAINT "account_credential_status_check" CHECK ("account_credentials"."status" IN ('unverified','active','revoked'));--> statement-breakpoint
ALTER TABLE "account_credentials" ADD CONSTRAINT "account_credential_version_check" CHECK ("account_credentials"."credential_version" >= 0);--> statement-breakpoint
ALTER TABLE "account_credentials" ADD CONSTRAINT "account_credential_active_source_check" CHECK ("account_credentials"."status" <> 'active' OR ("account_credentials"."upstream_issuer" IS NOT NULL AND "account_credentials"."upstream_owner_id" IS NOT NULL AND "account_credentials"."credential_ref" IS NOT NULL AND "account_credentials"."credential_version" > 0 AND "account_credentials"."verified_at" IS NOT NULL));
-- Existing mutable new_api_user_id/email values are hints, never payer provenance.
--> statement-breakpoint
INSERT INTO "account_identities" ("user_id", "evidence")
SELECT "id", '{"kind":"legacy_unverified"}'::jsonb FROM "user"
ON CONFLICT ("user_id") DO NOTHING;
