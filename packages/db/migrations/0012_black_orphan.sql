CREATE TABLE "design_scheme_source_preparations" (
	"user_id" text NOT NULL,
	"execution_id" varchar(64) NOT NULL,
	"confirmation_id" varchar(64) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"request" jsonb NOT NULL,
	"evidence" jsonb,
	"status" varchar(16) NOT NULL,
	"snapshot_id" varchar(64),
	"content_hash" varchar(64),
	"confirmation" jsonb,
	"upload_lease_until" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone,
	CONSTRAINT "design_scheme_source_preparations_user_id_execution_id_pk" PRIMARY KEY("user_id","execution_id"),
	CONSTRAINT "scheme_source_preparation_status_check" CHECK ("design_scheme_source_preparations"."status" IN ('reading','ready','confirmed','rejected','cancelled','expired','failed')),
	CONSTRAINT "scheme_source_preparation_ready_check" CHECK ("design_scheme_source_preparations"."status" NOT IN ('ready','confirmed') OR ("design_scheme_source_preparations"."snapshot_id" IS NOT NULL AND "design_scheme_source_preparations"."content_hash" IS NOT NULL AND "design_scheme_source_preparations"."confirmation" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "design_scheme_source_preparations" ADD CONSTRAINT "design_scheme_source_preparations_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_scheme_source_preparations" ADD CONSTRAINT "scheme_source_preparation_snapshot_owner_fk" FOREIGN KEY ("snapshot_id","user_id") REFERENCES "public"."design_scheme_source_snapshots"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scheme_source_preparation_expiry_idx" ON "design_scheme_source_preparations" USING btree ("expires_at","upload_lease_until");