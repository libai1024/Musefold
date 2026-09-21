CREATE TABLE "design_scheme_package_imports" (
	"stage_id" varchar(64) PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"authority_hash" varchar(64) NOT NULL,
	"confirmation_hash" varchar(64) NOT NULL,
	"parser_version" integer NOT NULL,
	"mapping_version" integer NOT NULL,
	"seed" varchar(36) NOT NULL,
	"attempt_id" varchar(36) NOT NULL,
	"epoch" integer DEFAULT 1 NOT NULL,
	"status" varchar(16) NOT NULL,
	"lease_until" timestamp with time zone NOT NULL,
	"plan_hash" varchar(64),
	"result" jsonb,
	"provenance" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scheme_package_import_version_check" CHECK ("design_scheme_package_imports"."parser_version" > 0 AND "design_scheme_package_imports"."mapping_version" > 0 AND "design_scheme_package_imports"."epoch" > 0),
	CONSTRAINT "scheme_package_import_status_check" CHECK ("design_scheme_package_imports"."status" IN ('running','retryable','completed')),
	CONSTRAINT "scheme_package_import_result_check" CHECK (("design_scheme_package_imports"."status" = 'completed') = ("design_scheme_package_imports"."result" IS NOT NULL) AND ("design_scheme_package_imports"."status" <> 'completed' OR "design_scheme_package_imports"."plan_hash" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "design_scheme_package_stages" DROP CONSTRAINT "scheme_package_stage_status_check";--> statement-breakpoint
ALTER TABLE "design_scheme_package_stages" DROP CONSTRAINT "scheme_package_stage_ready_check";--> statement-breakpoint
ALTER TABLE "design_scheme_package_stages" ADD CONSTRAINT "scheme_package_stage_id_owner_unique" UNIQUE("id","user_id");--> statement-breakpoint
ALTER TABLE "design_scheme_package_imports" ADD CONSTRAINT "scheme_package_import_stage_owner_fk" FOREIGN KEY ("stage_id","user_id") REFERENCES "public"."design_scheme_package_stages"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scheme_package_import_lease_idx" ON "design_scheme_package_imports" USING btree ("status","lease_until");--> statement-breakpoint
ALTER TABLE "design_scheme_package_stages" ADD CONSTRAINT "scheme_package_stage_status_check" CHECK ("design_scheme_package_stages"."status" IN ('awaiting_upload','uploading','ready','confirmed','imported','rejected','cancelled','expired','failed'));--> statement-breakpoint
ALTER TABLE "design_scheme_package_stages" ADD CONSTRAINT "scheme_package_stage_ready_check" CHECK ("design_scheme_package_stages"."status" NOT IN ('ready','confirmed','imported') OR ("design_scheme_package_stages"."preview" IS NOT NULL AND "design_scheme_package_stages"."confirmation_hash" IS NOT NULL));