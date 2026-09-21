CREATE TABLE "object_key_retirements" (
	"key_hash" varchar(64) PRIMARY KEY NOT NULL,
	"retired_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "object_key_retirements_hash_check" CHECK ("object_key_retirements"."key_hash" ~ '^[0-9a-f]{64}$')
);

--> statement-breakpoint
CREATE FUNCTION musefold_lock_storage_key(value text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE namespace text;
BEGIN
  IF value IS NULL THEN RETURN; END IF;
  namespace := substring(value FROM '^(users/[^/]+/generations/[^/]+/)');
  IF namespace IS NULL THEN
    namespace := substring(value FROM '^(scheme-imports/[^/]+/[^/]+/)');
  END IF;
  IF namespace IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('musefold:storage:namespace:' || namespace, 0));
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('musefold:storage:key:' || value, 0));
END $$;

--> statement-breakpoint
CREATE FUNCTION musefold_assert_storage_key_live(value text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF value IS NULL THEN RETURN; END IF;
  PERFORM musefold_lock_storage_key(value);
  IF EXISTS (SELECT 1 FROM object_key_retirements
    WHERE key_hash=encode(sha256(convert_to(value,'UTF8')),'hex')) THEN
    RAISE EXCEPTION 'ObjectStorageKeyRetired' USING ERRCODE='P0001';
  END IF;
END $$;

--> statement-breakpoint
CREATE FUNCTION musefold_guard_storage_object() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='generation_reference_uploads' THEN
    IF NEW.status NOT IN ('uploading','available') THEN RETURN NEW; END IF;
  ELSIF TG_TABLE_NAME='design_scheme_package_stages' THEN
    IF NEW.status NOT IN ('awaiting_upload','ready','confirmed')
      AND (NEW.upload_lease_until IS NULL OR NEW.upload_lease_until<=clock_timestamp())
      THEN RETURN NEW; END IF;
  ELSIF TG_TABLE_NAME='design_scheme_package_exports' THEN
    IF NEW.status NOT IN ('preparing','ready') AND NEW.lease_until<=clock_timestamp()
      THEN RETURN NEW; END IF;
  END IF;
  PERFORM musefold_assert_storage_key_live(NEW.object_key);
  RETURN NEW;
END $$;

--> statement-breakpoint
CREATE TRIGGER generation_assets_storage_publication
  BEFORE INSERT OR UPDATE OF object_key ON generation_assets
  FOR EACH ROW EXECUTE FUNCTION musefold_guard_storage_object();
--> statement-breakpoint
CREATE TRIGGER design_scheme_assets_storage_publication
  BEFORE INSERT OR UPDATE OF object_key ON design_scheme_assets
  FOR EACH ROW EXECUTE FUNCTION musefold_guard_storage_object();
--> statement-breakpoint
CREATE TRIGGER design_scheme_sources_storage_publication
  BEFORE INSERT OR UPDATE OF object_key ON design_scheme_source_files
  FOR EACH ROW EXECUTE FUNCTION musefold_guard_storage_object();
--> statement-breakpoint
CREATE TRIGGER design_scheme_references_storage_publication
  BEFORE INSERT OR UPDATE OF object_key ON design_scheme_generation_references
  FOR EACH ROW EXECUTE FUNCTION musefold_guard_storage_object();
--> statement-breakpoint
CREATE TRIGGER generation_uploads_storage_publication
  BEFORE INSERT OR UPDATE OF object_key,status,expires_at ON generation_reference_uploads
  FOR EACH ROW EXECUTE FUNCTION musefold_guard_storage_object();
--> statement-breakpoint
CREATE TRIGGER package_stages_storage_publication
  BEFORE INSERT OR UPDATE OF object_key,status,expires_at,upload_lease_until ON design_scheme_package_stages
  FOR EACH ROW EXECUTE FUNCTION musefold_guard_storage_object();
--> statement-breakpoint
CREATE TRIGGER package_exports_storage_publication
  BEFORE INSERT OR UPDATE OF object_key,status,expires_at,lease_until ON design_scheme_package_exports
  FOR EACH ROW EXECUTE FUNCTION musefold_guard_storage_object();

--> statement-breakpoint
CREATE FUNCTION musefold_guard_reference_link_storage() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE value text;
BEGIN
  SELECT object_key INTO value FROM generation_reference_uploads
    WHERE id=NEW.reference_id AND user_id=NEW.user_id;
  PERFORM musefold_assert_storage_key_live(value);
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER generation_links_storage_publication
  BEFORE INSERT OR UPDATE OF reference_id,user_id ON generation_reference_links
  FOR EACH ROW EXECUTE FUNCTION musefold_guard_reference_link_storage();

--> statement-breakpoint
CREATE FUNCTION musefold_guard_generation_storage_lease() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'musefold:storage:namespace:users/' || NEW.user_id || '/generations/' || NEW.id || '/',0));
  IF TG_OP='UPDATE' THEN
    -- A renewal that waited behind GC cannot resurrect the same expired epoch.
    IF OLD.lease_expires_at IS NOT NULL AND OLD.lease_expires_at<=clock_timestamp()
      AND NEW.lease_expires_at>clock_timestamp() AND NEW.attempt_count=OLD.attempt_count
      AND OLD.status IN ('running','cancelling') AND NEW.status IN ('running','cancelling')
      THEN RAISE EXCEPTION 'ObjectStorageLeaseExpired' USING ERRCODE='P0001'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER generation_runs_storage_lease
  BEFORE INSERT OR UPDATE OF user_id,id,status,lease_expires_at,attempt_count ON generation_runs
  FOR EACH ROW EXECUTE FUNCTION musefold_guard_generation_storage_lease();

--> statement-breakpoint
CREATE FUNCTION musefold_guard_import_storage_lease() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'musefold:storage:namespace:scheme-imports/' || NEW.stage_id || '/' || NEW.attempt_id || '/',0));
  IF TG_OP='UPDATE' THEN
    IF OLD.status='running' AND NEW.status='running' AND OLD.attempt_id=NEW.attempt_id
      AND OLD.epoch=NEW.epoch AND OLD.lease_until<=clock_timestamp()
      AND NEW.lease_until>clock_timestamp()
      THEN RAISE EXCEPTION 'ObjectStorageLeaseExpired' USING ERRCODE='P0001'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER package_imports_storage_lease
  BEFORE INSERT OR UPDATE OF stage_id,attempt_id,status,lease_until,epoch ON design_scheme_package_imports
  FOR EACH ROW EXECUTE FUNCTION musefold_guard_import_storage_lease();
