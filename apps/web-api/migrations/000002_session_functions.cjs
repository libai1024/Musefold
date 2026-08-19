'use strict';

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE auth.web_sessions
      ADD COLUMN credentials_ciphertext bytea;
    UPDATE auth.web_sessions SET credentials_ciphertext = access_ciphertext;
    ALTER TABLE auth.web_sessions
      ALTER COLUMN credentials_ciphertext SET NOT NULL,
      DROP COLUMN access_ciphertext,
      DROP COLUMN refresh_ciphertext;

    CREATE OR REPLACE FUNCTION auth.insert_web_session(
      p_id_hash text,
      p_owner_id bigint,
      p_username_snapshot text,
      p_credentials_ciphertext bytea,
      p_nonce bytea,
      p_auth_tag bytea,
      p_key_version integer,
      p_access_expires_at timestamptz,
      p_csrf_nonce text,
      p_absolute_expires_at timestamptz
    ) RETURNS void
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = auth, pg_temp
    AS $$
      INSERT INTO auth.web_sessions (
        id_hash, owner_id, username_snapshot, credentials_ciphertext,
        nonce, auth_tag, key_version, access_expires_at, csrf_nonce,
        absolute_expires_at
      ) VALUES (
        p_id_hash, p_owner_id, p_username_snapshot, p_credentials_ciphertext,
        p_nonce, p_auth_tag, p_key_version, p_access_expires_at, p_csrf_nonce,
        p_absolute_expires_at
      )
    $$;

    CREATE OR REPLACE FUNCTION auth.find_web_session(p_id_hash text)
    RETURNS TABLE (
      id_hash text,
      owner_id bigint,
      username_snapshot text,
      credentials_ciphertext bytea,
      nonce bytea,
      auth_tag bytea,
      key_version integer,
      access_expires_at timestamptz,
      csrf_nonce text,
      created_at timestamptz,
      last_seen_at timestamptz,
      absolute_expires_at timestamptz,
      revoked_at timestamptz
    )
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = auth, pg_temp
    AS $$
      SELECT
        s.id_hash::text, s.owner_id, s.username_snapshot,
        s.credentials_ciphertext, s.nonce, s.auth_tag, s.key_version,
        s.access_expires_at, s.csrf_nonce, s.created_at, s.last_seen_at,
        s.absolute_expires_at, s.revoked_at
      FROM auth.web_sessions s
      WHERE s.id_hash = p_id_hash
        AND s.revoked_at IS NULL
        AND s.absolute_expires_at > now()
        AND s.last_seen_at > now() - interval '7 days'
    $$;

    CREATE OR REPLACE FUNCTION auth.touch_web_session(p_id_hash text)
    RETURNS void
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = auth, pg_temp
    AS $$
      UPDATE auth.web_sessions SET last_seen_at = now()
      WHERE id_hash = p_id_hash AND revoked_at IS NULL
    $$;

    CREATE OR REPLACE FUNCTION auth.revoke_web_session(p_id_hash text)
    RETURNS void
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = auth, pg_temp
    AS $$
      UPDATE auth.web_sessions SET revoked_at = now()
      WHERE id_hash = p_id_hash AND revoked_at IS NULL
    $$;

    CREATE OR REPLACE FUNCTION auth.replace_web_session_credentials(
      p_id_hash text,
      p_credentials_ciphertext bytea,
      p_nonce bytea,
      p_auth_tag bytea,
      p_key_version integer,
      p_access_expires_at timestamptz
    ) RETURNS void
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = auth, pg_temp
    AS $$
      UPDATE auth.web_sessions
      SET credentials_ciphertext = p_credentials_ciphertext,
          nonce = p_nonce,
          auth_tag = p_auth_tag,
          key_version = p_key_version,
          access_expires_at = p_access_expires_at,
          last_seen_at = now()
      WHERE id_hash = p_id_hash AND revoked_at IS NULL
    $$;

    DO $permissions$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'musefold_app') THEN
        GRANT USAGE ON SCHEMA auth TO musefold_app;
        GRANT EXECUTE ON FUNCTION auth.insert_web_session(text,bigint,text,bytea,bytea,bytea,integer,timestamptz,text,timestamptz) TO musefold_app;
        GRANT EXECUTE ON FUNCTION auth.find_web_session(text) TO musefold_app;
        GRANT EXECUTE ON FUNCTION auth.touch_web_session(text) TO musefold_app;
        GRANT EXECUTE ON FUNCTION auth.revoke_web_session(text) TO musefold_app;
        GRANT EXECUTE ON FUNCTION auth.replace_web_session_credentials(text,bytea,bytea,bytea,integer,timestamptz) TO musefold_app;
      END IF;
    END
    $permissions$;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP FUNCTION IF EXISTS auth.revoke_web_session(text);
    DROP FUNCTION IF EXISTS auth.replace_web_session_credentials(text,bytea,bytea,bytea,integer,timestamptz);
    DROP FUNCTION IF EXISTS auth.touch_web_session(text);
    DROP FUNCTION IF EXISTS auth.find_web_session(text);
    DROP FUNCTION IF EXISTS auth.insert_web_session(text,bigint,text,bytea,bytea,bytea,integer,timestamptz,text,timestamptz);
    ALTER TABLE auth.web_sessions
      ADD COLUMN access_ciphertext bytea;
    UPDATE auth.web_sessions SET access_ciphertext = credentials_ciphertext;
    ALTER TABLE auth.web_sessions
      ALTER COLUMN access_ciphertext SET NOT NULL,
      ADD COLUMN refresh_ciphertext bytea NOT NULL DEFAULT decode('', 'hex'),
      DROP COLUMN credentials_ciphertext;
  `);
};
