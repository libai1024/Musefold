CREATE TABLE "design_scheme_package_stages" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"request_id" varchar(64) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"package_hash" varchar(64) NOT NULL,
	"byte_size" integer NOT NULL,
	"format_version" integer NOT NULL,
	"parser_version" integer NOT NULL,
	"object_key" varchar(512) NOT NULL,
	"status" varchar(24) NOT NULL,
	"upload_lease_until" timestamp with time zone,
	"preview" jsonb,
	"confirmation_hash" varchar(64),
	"authority_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scheme_package_stage_request_owner_unique" UNIQUE("user_id","request_id"),
	CONSTRAINT "scheme_package_stage_object_unique" UNIQUE("object_key"),
	CONSTRAINT "scheme_package_stage_size_check" CHECK ("design_scheme_package_stages"."byte_size" > 0 AND "design_scheme_package_stages"."byte_size" <= 268435456),
	CONSTRAINT "scheme_package_stage_format_check" CHECK ("design_scheme_package_stages"."format_version" IN (1,2) AND "design_scheme_package_stages"."parser_version" > 0),
	CONSTRAINT "scheme_package_stage_status_check" CHECK ("design_scheme_package_stages"."status" IN ('awaiting_upload','uploading','ready','confirmed','rejected','cancelled','expired','failed')),
	CONSTRAINT "scheme_package_stage_ready_check" CHECK ("design_scheme_package_stages"."status" NOT IN ('ready','confirmed') OR ("design_scheme_package_stages"."preview" IS NOT NULL AND "design_scheme_package_stages"."confirmation_hash" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "design_scheme_package_stages" ADD CONSTRAINT "design_scheme_package_stages_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scheme_package_stage_expiry_idx" ON "design_scheme_package_stages" USING btree ("expires_at","upload_lease_until");