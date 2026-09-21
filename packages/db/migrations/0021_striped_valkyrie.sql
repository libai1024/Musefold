CREATE TABLE "design_scheme_package_exports" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"request_id" varchar(64) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"authority_hash" varchar(64) NOT NULL,
	"scheme_id" varchar(64) NOT NULL,
	"revision_id" varchar(64) NOT NULL,
	"expected_version" integer NOT NULL,
	"basis_hash" varchar(64) NOT NULL,
	"object_key" varchar(512) NOT NULL,
	"status" varchar(16) NOT NULL,
	"package_hash" varchar(64),
	"size_bytes" integer,
	"lease_until" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scheme_package_export_owner_request_unique" UNIQUE("user_id","request_id"),
	CONSTRAINT "scheme_package_export_object_unique" UNIQUE("object_key"),
	CONSTRAINT "scheme_package_export_status_check" CHECK ("design_scheme_package_exports"."status" IN ('preparing','ready','cancelled','failed','expired')),
	CONSTRAINT "scheme_package_export_version_check" CHECK ("design_scheme_package_exports"."expected_version" > 0),
	CONSTRAINT "scheme_package_export_size_check" CHECK ("design_scheme_package_exports"."size_bytes" IS NULL OR ("design_scheme_package_exports"."size_bytes" > 0 AND "design_scheme_package_exports"."size_bytes" <= 268435456)),
	CONSTRAINT "scheme_package_export_ready_check" CHECK ("design_scheme_package_exports"."status" <> 'ready' OR ("design_scheme_package_exports"."package_hash" IS NOT NULL AND "design_scheme_package_exports"."size_bytes" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "design_scheme_package_exports" ADD CONSTRAINT "design_scheme_package_exports_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scheme_package_export_expiry_idx" ON "design_scheme_package_exports" USING btree ("status","expires_at");