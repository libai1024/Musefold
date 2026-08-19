"use strict";

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE ops.rate_limit_buckets (
      key_hash char(64) PRIMARY KEY,
      tokens double precision NOT NULL CHECK (tokens >= 0),
      updated_at timestamptz NOT NULL,
      expires_at timestamptz NOT NULL
    );
    CREATE INDEX rate_limit_buckets_expiry_idx
      ON ops.rate_limit_buckets (expires_at);

    CREATE OR REPLACE FUNCTION ops.consume_rate_limit(
      p_key_hash text,
      p_capacity integer,
      p_refill_per_second double precision,
      p_cost integer DEFAULT 1
    ) RETURNS TABLE (
      allowed boolean,
      remaining_tokens integer,
      retry_after_seconds integer
    )
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
    AS $function$
    DECLARE
      v_tokens double precision;
      v_updated_at timestamptz;
      v_now timestamptz := clock_timestamp();
      v_available double precision;
      v_ttl_seconds double precision;
    BEGIN
      IF p_key_hash !~ '^[0-9a-f]{64}$'
        OR p_capacity < 1
        OR p_refill_per_second <= 0
        OR p_cost < 1
        OR p_cost > p_capacity THEN
        RAISE EXCEPTION 'invalid rate limit arguments';
      END IF;

      v_ttl_seconds := greatest(
        60,
        ceil((p_capacity / p_refill_per_second) * 2)
      );

      LOOP
        SELECT bucket.tokens, bucket.updated_at
        INTO v_tokens, v_updated_at
        FROM ops.rate_limit_buckets AS bucket
        WHERE bucket.key_hash = p_key_hash
        FOR UPDATE;
        EXIT WHEN FOUND;

        BEGIN
          INSERT INTO ops.rate_limit_buckets (
            key_hash, tokens, updated_at, expires_at
          ) VALUES (
            p_key_hash,
            p_capacity,
            v_now,
            v_now + make_interval(secs => v_ttl_seconds)
          );
        EXCEPTION WHEN unique_violation THEN
          NULL;
        END;
      END LOOP;

      v_available := least(
        p_capacity,
        v_tokens + greatest(0, extract(epoch FROM v_now - v_updated_at))
          * p_refill_per_second
      );
      allowed := v_available >= p_cost;
      IF allowed THEN
        v_tokens := v_available - p_cost;
        retry_after_seconds := 0;
      ELSE
        v_tokens := v_available;
        retry_after_seconds := greatest(
          1,
          ceil((p_cost - v_available) / p_refill_per_second)::integer
        );
      END IF;
      remaining_tokens := floor(v_tokens)::integer;

      UPDATE ops.rate_limit_buckets
      SET tokens = v_tokens,
          updated_at = v_now,
          expires_at = v_now + make_interval(secs => v_ttl_seconds)
      WHERE key_hash = p_key_hash;
      RETURN NEXT;
    END
    $function$;

    REVOKE ALL ON TABLE ops.rate_limit_buckets FROM PUBLIC;
    REVOKE ALL ON FUNCTION ops.consume_rate_limit(text,integer,double precision,integer) FROM PUBLIC;

    DO $permissions$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'musefold_app') THEN
        GRANT EXECUTE ON FUNCTION ops.consume_rate_limit(text,integer,double precision,integer) TO musefold_app;
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'musefold_worker') THEN
        GRANT SELECT, DELETE ON ops.rate_limit_buckets TO musefold_worker;
      END IF;
    END
    $permissions$;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP FUNCTION IF EXISTS ops.consume_rate_limit(text,integer,double precision,integer);
    DROP TABLE IF EXISTS ops.rate_limit_buckets;
  `);
};
