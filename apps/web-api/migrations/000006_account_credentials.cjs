'use strict';

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE auth.account_credentials (
      owner_id bigint PRIMARY KEY,
      provider varchar(32) NOT NULL,
      credential_ciphertext bytea NOT NULL,
      nonce bytea NOT NULL,
      auth_tag bytea NOT NULL,
      key_version integer NOT NULL CHECK (key_version > 0),
      external_token_id bigint,
      created_at timestamptz NOT NULL DEFAULT now(),
      rotated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE OR REPLACE FUNCTION auth.upsert_account_credential(
      p_owner_id bigint,
      p_provider text,
      p_credential_ciphertext bytea,
      p_nonce bytea,
      p_auth_tag bytea,
      p_key_version integer,
      p_external_token_id bigint
    ) RETURNS void
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = auth, pg_temp
    AS $$
      INSERT INTO auth.account_credentials(
        owner_id, provider, credential_ciphertext, nonce, auth_tag,
        key_version, external_token_id
      ) VALUES (
        p_owner_id, p_provider, p_credential_ciphertext, p_nonce, p_auth_tag,
        p_key_version, p_external_token_id
      )
      ON CONFLICT (owner_id) DO UPDATE SET
        provider = EXCLUDED.provider,
        credential_ciphertext = EXCLUDED.credential_ciphertext,
        nonce = EXCLUDED.nonce,
        auth_tag = EXCLUDED.auth_tag,
        key_version = EXCLUDED.key_version,
        external_token_id = EXCLUDED.external_token_id,
        rotated_at = now()
    $$;

    CREATE OR REPLACE FUNCTION auth.find_account_credential(p_owner_id bigint)
    RETURNS TABLE (
      owner_id bigint,
      provider text,
      credential_ciphertext bytea,
      nonce bytea,
      auth_tag bytea,
      key_version integer,
      external_token_id bigint,
      rotated_at timestamptz
    )
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = auth, pg_temp
    AS $$
      SELECT c.owner_id, c.provider::text, c.credential_ciphertext,
        c.nonce, c.auth_tag, c.key_version, c.external_token_id, c.rotated_at
      FROM auth.account_credentials c WHERE c.owner_id = p_owner_id
    $$;

    DO $permissions$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'musefold_app') THEN
        GRANT EXECUTE ON FUNCTION auth.upsert_account_credential(bigint,text,bytea,bytea,bytea,integer,bigint) TO musefold_app;
        GRANT EXECUTE ON FUNCTION auth.find_account_credential(bigint) TO musefold_app;
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'musefold_worker') THEN
        GRANT EXECUTE ON FUNCTION auth.find_account_credential(bigint) TO musefold_worker;
      END IF;
    END
    $permissions$;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP FUNCTION IF EXISTS auth.find_account_credential(bigint);
    DROP FUNCTION IF EXISTS auth.upsert_account_credential(bigint,text,bytea,bytea,bytea,integer,bigint);
    DROP TABLE IF EXISTS auth.account_credentials;
  `);
};
