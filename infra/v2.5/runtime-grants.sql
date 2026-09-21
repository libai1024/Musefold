-- Run as the dedicated migration owner AFTER both application and Graphile migrations.
-- The three LOGIN roles must already exist with separately provisioned private credentials.
-- This file does not create roles/passwords, own data, or authorize a production deployment.
BEGIN;
DO $$
DECLARE runtime_role text;
BEGIN
  FOREACH runtime_role IN ARRAY ARRAY['musefold_v25_api', 'musefold_v25_worker', 'musefold_v25_agent'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = runtime_role AND rolcanlogin
      AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls)
      OR EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname=runtime_role)
      -- Shared ownership dependencies also cover functions, types and other DDL
      -- objects, not only tables/schemas/databases (including other databases).
      OR EXISTS (SELECT 1 FROM pg_shdepend d JOIN pg_roles r ON r.oid=d.refobjid
        WHERE d.refclassid='pg_authid'::regclass AND d.deptype='o' AND r.rolname=runtime_role)
    THEN RAISE EXCEPTION 'V25_RUNTIME_ROLE_UNSAFE_OR_MISSING'; END IF;
  END LOOP;
END $$;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA public, graphile_worker, drizzle
  FROM musefold_v25_api, musefold_v25_worker, musefold_v25_agent;
GRANT USAGE ON SCHEMA public, graphile_worker, drizzle
  TO musefold_v25_api, musefold_v25_worker, musefold_v25_agent;

-- Trusted application services enforce owner checks. These are DML-only roles, not a claim
-- of per-tenant RLS or per-domain table isolation. No TRUNCATE, ownership or DDL is granted.
REVOKE ALL ON ALL TABLES IN SCHEMA public, graphile_worker, drizzle
  FROM musefold_v25_api, musefold_v25_worker, musefold_v25_agent;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public, graphile_worker
  TO musefold_v25_api, musefold_v25_worker, musefold_v25_agent;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public, graphile_worker
  TO musefold_v25_api, musefold_v25_worker, musefold_v25_agent;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public, graphile_worker
  TO musefold_v25_api, musefold_v25_worker, musefold_v25_agent;

-- Graphile Worker 0.17 enables RLS on its four private tables. DML grants alone
-- cannot enqueue/claim/acknowledge jobs. Explicit policies target ONLY these trusted
-- service roles; RLS stays enabled and unrelated database roles remain default-denied.
-- Review this allowlist whenever the pinned Graphile schema changes; fail closed.
DO $$
DECLARE queue_table text;
DECLARE expected_tables text[] := ARRAY[
  '_private_job_queues', '_private_jobs', '_private_known_crontabs', '_private_tasks'
];
BEGIN
  IF (SELECT max(id) FROM graphile_worker.migrations) IS DISTINCT FROM 19
    OR (SELECT array_agg(c.relname::text ORDER BY c.relname)
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='graphile_worker' AND c.relrowsecurity)
      IS DISTINCT FROM expected_tables
  THEN RAISE EXCEPTION 'V25_GRAPHILE_SCHEMA_REVIEW_REQUIRED'; END IF;
  FOREACH queue_table IN ARRAY expected_tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS musefold_v25_runtime ON graphile_worker.%I', queue_table);
    EXECUTE format(
      'CREATE POLICY musefold_v25_runtime ON graphile_worker.%I FOR ALL
       TO musefold_v25_api, musefold_v25_worker, musefold_v25_agent
       USING (true) WITH CHECK (true)', queue_table);
  END LOOP;
END $$;

-- Startup may verify migration versions, but runtime credentials cannot fabricate them.
REVOKE INSERT, UPDATE, DELETE ON graphile_worker.migrations
  FROM musefold_v25_api, musefold_v25_worker, musefold_v25_agent;
GRANT SELECT ON drizzle.__drizzle_migrations
  TO musefold_v25_api, musefold_v25_worker, musefold_v25_agent;
DO $$
DECLARE runtime_role text;
BEGIN
  FOREACH runtime_role IN ARRAY ARRAY['musefold_v25_api', 'musefold_v25_worker', 'musefold_v25_agent'] LOOP
    IF has_database_privilege(runtime_role, current_database(), 'CREATE') OR EXISTS (
      SELECT 1 FROM pg_namespace n WHERE has_schema_privilege(runtime_role, n.oid, 'CREATE')
    ) THEN RAISE EXCEPTION 'V25_RUNTIME_DDL_PRIVILEGE_REMAINS'; END IF;
  END LOOP;
END $$;
COMMIT;
