CREATE TABLE "design_scheme_purge_identities" (
	"scheme_id" varchar(64) PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"version" integer NOT NULL,
	"retired_keys" integer DEFAULT 0 NOT NULL,
	"deferred_keys" integer DEFAULT 0 NOT NULL,
	"purged_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "design_scheme_purge_identities_version_check" CHECK ("design_scheme_purge_identities"."version" > 0),
	CONSTRAINT "design_scheme_purge_counts_check" CHECK ("retired_keys" >= 0 AND "deferred_keys" >= 0)
);
--> statement-breakpoint
CREATE TABLE "design_scheme_purge_revision_identities" (
	"revision_id" varchar(64) PRIMARY KEY NOT NULL,
	"scheme_id" varchar(64) NOT NULL,
	"user_id" text NOT NULL,
	"purged_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "object_cleanup_queue" DROP CONSTRAINT "object_cleanup_queue_reason_check";--> statement-breakpoint
ALTER TABLE "design_scheme_runs" ADD COLUMN "origin_scheme_id" varchar(64);--> statement-breakpoint
ALTER TABLE "design_scheme_runs" ADD COLUMN "origin_revision_id" varchar(64);--> statement-breakpoint
UPDATE "design_scheme_runs" SET "origin_scheme_id" = "scheme_id", "origin_revision_id" = "revision_id";--> statement-breakpoint
ALTER TABLE "design_scheme_runs" ALTER COLUMN "scheme_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "design_scheme_runs" ALTER COLUMN "revision_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "design_scheme_purge_identities" ADD CONSTRAINT "design_scheme_purge_identities_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_scheme_purge_revision_identities" ADD CONSTRAINT "design_scheme_purge_revision_identities_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_cleanup_queue" ADD CONSTRAINT "object_cleanup_queue_reason_check" CHECK ("object_cleanup_queue"."reason" IN ('generation_purge', 'generation_compensation', 'reference_expired', 'reference_upload_failed', 'design_scheme_purge'));
--> statement-breakpoint
CREATE FUNCTION musefold_guard_scheme_purge_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'design_schemes' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('musefold:scheme-identity:' || NEW.id, 0));
    IF EXISTS (SELECT 1 FROM design_scheme_purge_identities WHERE scheme_id = NEW.id) THEN
      RAISE EXCEPTION 'DesignSchemeIdentityPurged' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    PERFORM pg_advisory_xact_lock(hashtextextended('musefold:revision-identity:' || NEW.revision_id, 0));
    IF EXISTS (SELECT 1 FROM design_scheme_purge_revision_identities WHERE revision_id = NEW.revision_id) THEN
      RAISE EXCEPTION 'DesignSchemeRevisionIdentityPurged' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER design_schemes_purge_identity BEFORE INSERT OR UPDATE OF id ON design_schemes
  FOR EACH ROW EXECUTE FUNCTION musefold_guard_scheme_purge_identity();
--> statement-breakpoint
CREATE TRIGGER design_scheme_revisions_purge_identity BEFORE INSERT OR UPDATE OF revision_id ON design_scheme_revisions
  FOR EACH ROW EXECUTE FUNCTION musefold_guard_scheme_purge_identity();
