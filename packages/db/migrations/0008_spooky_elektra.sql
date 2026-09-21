CREATE TABLE "design_scheme_generation_references" (
	"generation_run_id" varchar(64) NOT NULL,
	"user_id" text NOT NULL,
	"asset_id" varchar(64) NOT NULL,
	"position" integer NOT NULL,
	"object_key" varchar(512) NOT NULL,
	"name" varchar(200) NOT NULL,
	"mime_type" varchar(32) NOT NULL,
	"byte_size" integer NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	CONSTRAINT "design_scheme_generation_references_generation_run_id_asset_id_pk" PRIMARY KEY("generation_run_id","asset_id"),
	CONSTRAINT "design_scheme_generation_references_position_unique" UNIQUE("generation_run_id","position"),
	CONSTRAINT "design_scheme_generation_references_position_check" CHECK ("design_scheme_generation_references"."position" >= 0 AND "design_scheme_generation_references"."position" < 16),
	CONSTRAINT "design_scheme_generation_references_size_check" CHECK ("design_scheme_generation_references"."byte_size" > 0 AND "design_scheme_generation_references"."byte_size" <= 20971520)
);
--> statement-breakpoint
CREATE TABLE "design_scheme_run_executions" (
	"execution_id" varchar(64) NOT NULL,
	"user_id" text NOT NULL,
	"request_hash" varchar(64),
	"prepared_input" jsonb,
	"run_id" varchar(64),
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "design_scheme_run_executions_user_id_execution_id_pk" PRIMARY KEY("user_id","execution_id"),
	CONSTRAINT "design_scheme_run_executions_run_owner_unique" UNIQUE("run_id","user_id"),
	CONSTRAINT "design_scheme_run_executions_preparation_check" CHECK (("design_scheme_run_executions"."request_hash" IS NULL) = ("design_scheme_run_executions"."prepared_input" IS NULL)),
	CONSTRAINT "design_scheme_run_executions_identity_check" CHECK ("design_scheme_run_executions"."prepared_input" IS NULL OR ("design_scheme_run_executions"."prepared_input"->>'executionId') = "design_scheme_run_executions"."execution_id")
);
--> statement-breakpoint
ALTER TABLE "design_scheme_assets" DROP CONSTRAINT "design_scheme_assets_origin_check";--> statement-breakpoint
ALTER TABLE "generation_runs" ADD COLUMN "design_scheme_run_id" varchar(64);--> statement-breakpoint
ALTER TABLE "design_scheme_generation_references" ADD CONSTRAINT "design_scheme_generation_references_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_scheme_generation_references" ADD CONSTRAINT "design_scheme_generation_references_run_owner_fk" FOREIGN KEY ("generation_run_id","user_id") REFERENCES "public"."generation_runs"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_scheme_run_executions" ADD CONSTRAINT "design_scheme_run_executions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_scheme_run_executions" ADD CONSTRAINT "design_scheme_run_executions_run_owner_fk" FOREIGN KEY ("run_id","user_id") REFERENCES "public"."design_scheme_runs"("run_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "design_scheme_generation_references_object_idx" ON "design_scheme_generation_references" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "design_scheme_run_executions_expiry_idx" ON "design_scheme_run_executions" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "generation_runs" ADD CONSTRAINT "generation_runs_scheme_owner_fk" FOREIGN KEY ("design_scheme_run_id","user_id") REFERENCES "public"."design_scheme_runs"("run_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_runs" ADD CONSTRAINT "generation_runs_scheme_run_owner_unique" UNIQUE("design_scheme_run_id","user_id");--> statement-breakpoint
ALTER TABLE "design_scheme_assets" ADD CONSTRAINT "design_scheme_assets_origin_check" CHECK ("design_scheme_assets"."origin" IN ('repository', 'local-run', 'uploaded', 'cloud-run'));