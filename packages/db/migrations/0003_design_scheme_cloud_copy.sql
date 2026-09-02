CREATE TABLE "design_scheme_assets" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"revision_id" varchar(64) NOT NULL,
	"object_key" varchar(512) NOT NULL,
	"role" varchar(20) NOT NULL,
	"origin" varchar(20) NOT NULL,
	"mime_type" varchar(256) NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"byte_size" integer DEFAULT 0 NOT NULL,
	"content_hash" varchar(128) NOT NULL,
	"license" varchar(256),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "design_scheme_assets_id_user_unique" UNIQUE("id","user_id"),
	CONSTRAINT "design_scheme_assets_role_check" CHECK ("design_scheme_assets"."role" IN ('cover', 'example', 'reference', 'output')),
	CONSTRAINT "design_scheme_assets_origin_check" CHECK ("design_scheme_assets"."origin" IN ('repository', 'local-run')),
	CONSTRAINT "design_scheme_assets_dimensions_check" CHECK ("design_scheme_assets"."width" > 0 AND "design_scheme_assets"."height" > 0),
	CONSTRAINT "design_scheme_assets_byte_size_check" CHECK ("design_scheme_assets"."byte_size" >= 0)
);
--> statement-breakpoint
CREATE TABLE "design_scheme_evaluations" (
	"evaluation_id" varchar(64) PRIMARY KEY NOT NULL,
	"run_id" varchar(64) NOT NULL,
	"user_id" text NOT NULL,
	"passed" integer NOT NULL,
	"metrics" jsonb NOT NULL,
	"evidence" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "design_scheme_evaluations_passed_check" CHECK ("design_scheme_evaluations"."passed" IN (0, 1))
);
--> statement-breakpoint
CREATE TABLE "design_scheme_revisions" (
	"revision_id" varchar(64) PRIMARY KEY NOT NULL,
	"scheme_id" varchar(64) NOT NULL,
	"user_id" text NOT NULL,
	"schema_version" integer NOT NULL,
	"document" jsonb NOT NULL,
	"created_by" varchar(20) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "design_scheme_revisions_revision_user_unique" UNIQUE("revision_id","user_id"),
	CONSTRAINT "design_scheme_revisions_schema_version_check" CHECK ("design_scheme_revisions"."schema_version" > 0),
	CONSTRAINT "design_scheme_revisions_document_identity_check" CHECK (("design_scheme_revisions"."document"->>'revisionId') = "design_scheme_revisions"."revision_id" AND ("design_scheme_revisions"."document"->>'schemeId') = "design_scheme_revisions"."scheme_id"),
	CONSTRAINT "design_scheme_revisions_created_by_check" CHECK ("design_scheme_revisions"."created_by" IN ('agent', 'user', 'import'))
);
--> statement-breakpoint
CREATE TABLE "design_scheme_run_steps" (
	"run_id" varchar(64) NOT NULL,
	"step_id" varchar(64) NOT NULL,
	"user_id" text NOT NULL,
	"status" varchar(20) NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "design_scheme_run_steps_run_id_step_id_pk" PRIMARY KEY("run_id","step_id"),
	CONSTRAINT "design_scheme_run_steps_status_check" CHECK ("design_scheme_run_steps"."status" IN ('pending', 'running', 'completed', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "design_scheme_runs" (
	"run_id" varchar(64) PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"scheme_id" varchar(64) NOT NULL,
	"revision_id" varchar(64) NOT NULL,
	"mode" varchar(12) NOT NULL,
	"status" varchar(20) NOT NULL,
	"policy" jsonb NOT NULL,
	"provider" jsonb,
	"plan" jsonb,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "design_scheme_runs_run_user_unique" UNIQUE("run_id","user_id"),
	CONSTRAINT "design_scheme_runs_mode_check" CHECK ("design_scheme_runs"."mode" IN ('trial', 'formal')),
	CONSTRAINT "design_scheme_runs_status_check" CHECK ("design_scheme_runs"."status" IN ('planning', 'executing', 'evaluating', 'completed', 'blocked', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "design_scheme_source_bindings" (
	"revision_id" varchar(64) NOT NULL,
	"source_snapshot_id" varchar(64) NOT NULL,
	"user_id" text NOT NULL,
	"role" varchar(20) NOT NULL,
	CONSTRAINT "design_scheme_source_bindings_revision_id_source_snapshot_id_pk" PRIMARY KEY("revision_id","source_snapshot_id"),
	CONSTRAINT "design_scheme_source_bindings_role_check" CHECK ("design_scheme_source_bindings"."role" IN ('normative', 'reference', 'example', 'context'))
);
--> statement-breakpoint
CREATE TABLE "design_scheme_source_files" (
	"snapshot_id" varchar(64) NOT NULL,
	"relative_path" varchar(1024) NOT NULL,
	"user_id" text NOT NULL,
	"kind" varchar(12) NOT NULL,
	"mime_type" varchar(256),
	"size_bytes" integer NOT NULL,
	"content_hash" varchar(128) NOT NULL,
	"evidence_path" varchar(1024),
	"text_excerpt" text,
	"object_key" varchar(512),
	CONSTRAINT "design_scheme_source_files_snapshot_id_relative_path_pk" PRIMARY KEY("snapshot_id","relative_path"),
	CONSTRAINT "design_scheme_source_files_kind_check" CHECK ("design_scheme_source_files"."kind" IN ('text', 'image', 'other')),
	CONSTRAINT "design_scheme_source_files_size_bytes_check" CHECK ("design_scheme_source_files"."size_bytes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "design_scheme_source_packages" (
	"id" varchar(64) NOT NULL,
	"user_id" text NOT NULL,
	"kind" varchar(24) NOT NULL,
	"repository_url" varchar(2048),
	"license" varchar(256),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "design_scheme_source_packages_id_user_pk" PRIMARY KEY("id","user_id"),
	CONSTRAINT "design_scheme_source_packages_kind_check" CHECK ("design_scheme_source_packages"."kind" IN ('github', 'history', 'user-brief', 'share-import'))
);
--> statement-breakpoint
CREATE TABLE "design_scheme_source_snapshots" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"package_id" varchar(64) NOT NULL,
	"resolved_ref" varchar(256) NOT NULL,
	"commit_hash" varchar(64),
	"content_hash" varchar(128),
	"total_bytes" integer DEFAULT 0 NOT NULL,
	"scan" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "design_scheme_source_snapshots_id_user_unique" UNIQUE("id","user_id"),
	CONSTRAINT "design_scheme_source_snapshots_total_bytes_check" CHECK ("design_scheme_source_snapshots"."total_bytes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "design_schemes" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" varchar(120) NOT NULL,
	"summary" varchar(500) DEFAULT '' NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"source_presentation" varchar(24) NOT NULL,
	"source_label" varchar(160) DEFAULT '' NOT NULL,
	"current_revision_id" varchar(64) NOT NULL,
	"working_draft_revision_id" varchar(64),
	"cover_asset_id" varchar(64),
	"fidelity" varchar(20) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "design_schemes_id_user_id_unique" UNIQUE("id","user_id"),
	CONSTRAINT "design_schemes_status_check" CHECK ("design_schemes"."status" IN ('draft', 'formal')),
	CONSTRAINT "design_schemes_source_presentation_check" CHECK ("design_schemes"."source_presentation" IN ('skill', 'musefold-created')),
	CONSTRAINT "design_schemes_fidelity_check" CHECK ("design_schemes"."fidelity" IN ('verified', 'faithful', 'adapted', 'unsupported')),
	CONSTRAINT "design_schemes_version_check" CHECK ("design_schemes"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "design_scheme_assets" ADD CONSTRAINT "design_scheme_assets_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_scheme_assets" ADD CONSTRAINT "design_scheme_assets_revision_owner_fk" FOREIGN KEY ("revision_id","user_id") REFERENCES "public"."design_scheme_revisions"("revision_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_scheme_evaluations" ADD CONSTRAINT "design_scheme_evaluations_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_scheme_evaluations" ADD CONSTRAINT "design_scheme_evaluations_run_owner_fk" FOREIGN KEY ("run_id","user_id") REFERENCES "public"."design_scheme_runs"("run_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_scheme_revisions" ADD CONSTRAINT "design_scheme_revisions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_scheme_revisions" ADD CONSTRAINT "design_scheme_revisions_scheme_owner_fk" FOREIGN KEY ("scheme_id","user_id") REFERENCES "public"."design_schemes"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_scheme_run_steps" ADD CONSTRAINT "design_scheme_run_steps_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_scheme_run_steps" ADD CONSTRAINT "design_scheme_run_steps_run_owner_fk" FOREIGN KEY ("run_id","user_id") REFERENCES "public"."design_scheme_runs"("run_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_scheme_runs" ADD CONSTRAINT "design_scheme_runs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_scheme_runs" ADD CONSTRAINT "design_scheme_runs_scheme_owner_fk" FOREIGN KEY ("scheme_id","user_id") REFERENCES "public"."design_schemes"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_scheme_runs" ADD CONSTRAINT "design_scheme_runs_revision_owner_fk" FOREIGN KEY ("revision_id","user_id") REFERENCES "public"."design_scheme_revisions"("revision_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_scheme_source_bindings" ADD CONSTRAINT "design_scheme_source_bindings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_scheme_source_bindings" ADD CONSTRAINT "design_scheme_source_bindings_revision_owner_fk" FOREIGN KEY ("revision_id","user_id") REFERENCES "public"."design_scheme_revisions"("revision_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_scheme_source_bindings" ADD CONSTRAINT "design_scheme_source_bindings_snapshot_owner_fk" FOREIGN KEY ("source_snapshot_id","user_id") REFERENCES "public"."design_scheme_source_snapshots"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_scheme_source_files" ADD CONSTRAINT "design_scheme_source_files_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_scheme_source_files" ADD CONSTRAINT "design_scheme_source_files_snapshot_owner_fk" FOREIGN KEY ("snapshot_id","user_id") REFERENCES "public"."design_scheme_source_snapshots"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_scheme_source_packages" ADD CONSTRAINT "design_scheme_source_packages_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_scheme_source_snapshots" ADD CONSTRAINT "design_scheme_source_snapshots_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_scheme_source_snapshots" ADD CONSTRAINT "design_scheme_source_snapshots_package_owner_fk" FOREIGN KEY ("package_id","user_id") REFERENCES "public"."design_scheme_source_packages"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_schemes" ADD CONSTRAINT "design_schemes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "design_scheme_assets_user_revision_idx" ON "design_scheme_assets" USING btree ("user_id","revision_id","created_at");--> statement-breakpoint
CREATE INDEX "design_scheme_evaluations_user_run_idx" ON "design_scheme_evaluations" USING btree ("user_id","run_id","created_at");--> statement-breakpoint
CREATE INDEX "design_scheme_revisions_user_scheme_idx" ON "design_scheme_revisions" USING btree ("user_id","scheme_id","created_at");--> statement-breakpoint
CREATE INDEX "design_scheme_run_steps_user_run_idx" ON "design_scheme_run_steps" USING btree ("user_id","run_id");--> statement-breakpoint
CREATE INDEX "design_scheme_runs_user_scheme_created_idx" ON "design_scheme_runs" USING btree ("user_id","scheme_id","created_at");--> statement-breakpoint
CREATE INDEX "design_scheme_runs_user_status_idx" ON "design_scheme_runs" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "design_scheme_source_bindings_user_snapshot_idx" ON "design_scheme_source_bindings" USING btree ("user_id","source_snapshot_id");--> statement-breakpoint
CREATE INDEX "design_scheme_source_files_user_snapshot_idx" ON "design_scheme_source_files" USING btree ("user_id","snapshot_id");--> statement-breakpoint
CREATE INDEX "design_scheme_source_packages_user_created_idx" ON "design_scheme_source_packages" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "design_scheme_source_snapshots_user_package_idx" ON "design_scheme_source_snapshots" USING btree ("user_id","package_id","created_at");--> statement-breakpoint
CREATE INDEX "design_schemes_user_updated_idx" ON "design_schemes" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "design_schemes_user_status_idx" ON "design_schemes" USING btree ("user_id","status");