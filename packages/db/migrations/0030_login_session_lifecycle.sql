CREATE TABLE login_capacity_flows (
  id text PRIMARY KEY,
  binding_hash text NOT NULL,
  upstream_issuer text NOT NULL,
  ciphertext text NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','working','completed','cancelled')),
  operation_id text,
  selection_digest text,
  lease_id text,
  lease_until timestamptz,
  session_id text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX login_capacity_flows_expiry_idx ON login_capacity_flows(expires_at);
--> statement-breakpoint
CREATE TABLE login_session_releases (
  id text PRIMARY KEY,
  session_id text,
  upstream_issuer text NOT NULL,
  upstream_sid text NOT NULL,
  ciphertext text NOT NULL,
  state text NOT NULL DEFAULT 'candidate' CHECK (state IN ('candidate','active','pending','released','expired')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL,
  lease_id text,
  lease_until timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX login_release_issuer_sid_unique ON login_session_releases(upstream_issuer, upstream_sid);
--> statement-breakpoint
CREATE INDEX login_release_session_idx ON login_session_releases(session_id);
--> statement-breakpoint
CREATE INDEX login_release_due_idx ON login_session_releases(state, next_attempt_at);
--> statement-breakpoint
CREATE FUNCTION queue_deleted_login_release() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE login_session_releases
  SET state = 'pending', next_attempt_at = now(), lease_id = NULL, lease_until = NULL
  WHERE session_id = OLD.id AND state IN ('candidate','active');
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER queue_deleted_login_release BEFORE DELETE ON session
FOR EACH ROW EXECUTE FUNCTION queue_deleted_login_release();
