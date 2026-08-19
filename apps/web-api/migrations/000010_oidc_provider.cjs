"use strict";

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE auth.oauth_clients
      ADD COLUMN IF NOT EXISTS metadata jsonb;

    CREATE TABLE auth.oidc_provider_artifacts (
      model varchar(64) NOT NULL,
      id varchar(512) NOT NULL,
      payload jsonb NOT NULL,
      expires_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (model, id)
    );

    CREATE INDEX oidc_provider_artifacts_expiry_idx
      ON auth.oidc_provider_artifacts(expires_at)
      WHERE expires_at IS NOT NULL;
    CREATE INDEX oidc_provider_artifacts_uid_idx
      ON auth.oidc_provider_artifacts(model, (payload ->> 'uid'))
      WHERE payload ? 'uid';
    CREATE INDEX oidc_provider_artifacts_user_code_idx
      ON auth.oidc_provider_artifacts(model, (payload ->> 'userCode'))
      WHERE payload ? 'userCode';
    CREATE INDEX oidc_provider_artifacts_grant_idx
      ON auth.oidc_provider_artifacts((payload ->> 'grantId'))
      WHERE payload ? 'grantId';

    GRANT SELECT, INSERT, UPDATE, DELETE ON auth.oidc_provider_artifacts TO musefold_app;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS auth.oidc_provider_artifacts;
    ALTER TABLE auth.oauth_clients DROP COLUMN IF EXISTS metadata;
  `);
};
