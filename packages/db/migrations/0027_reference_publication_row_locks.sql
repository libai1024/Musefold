-- Pin the registry row before waiting for its key lock. A concurrent key update
-- must not make the checked object differ from the object reached by the link.
CREATE OR REPLACE FUNCTION musefold_guard_reference_link_storage() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE value text;
BEGIN
  SELECT object_key INTO value FROM generation_reference_uploads
    WHERE id=NEW.reference_id AND user_id=NEW.user_id FOR SHARE;
  PERFORM musefold_assert_storage_key_live(value);
  RETURN NEW;
END $$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION musefold_guard_storage_object() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='generation_reference_uploads' THEN
    -- Inactive unreferenced rows may remain as cleanup intent for retired keys.
    -- Existing links make even an inactive registry row canonical protection.
    IF NEW.status NOT IN ('uploading','available') AND NOT EXISTS (
      SELECT 1 FROM generation_reference_links
      WHERE reference_id=NEW.id AND user_id=NEW.user_id
    ) THEN RETURN NEW; END IF;
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
