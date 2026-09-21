import type pg from 'pg';

export const maintenanceTables = [
  'design_scheme_package_stages',
  'design_scheme_source_preparations',
  'design_scheme_source_packages',
  'design_scheme_source_snapshots',
  'design_scheme_source_files',
  'account_recovery_requests',
  'account_recovery_backup_evidence',
  'rate_limit_buckets',
  'generation_runs',
  'generation_assets',
  'prompts',
  'prompt_usage_events',
  'sync_devices',
  'sync_change_log',
  'sync_mutation_results',
  'sync_retention_state',
  'generation_reference_uploads',
  'object_cleanup_queue',
] as const;

export async function maintenanceFacts(pool: pg.Pool) {
  const facts: Record<string, unknown[]> = {};
  for (const table of maintenanceTables) {
    facts[table] = (
      await pool.query(`SELECT * FROM ${table} ORDER BY row_to_json(${table})::text`)
    ).rows;
  }
  return facts;
}

/** SQL-only historic maintenance records, not paid execution or user-owned data. */
export async function seedMaintenanceMatrix(pool: pg.Pool) {
  await pool.query(
    `INSERT INTO "user"(id,name,email) VALUES ('owned-maintenance','Owned','maintenance@example.test')`,
  );
  const expiredKeys: string[] = [];
  const liveKeys: string[] = [];
  await pool.query(
    "INSERT INTO sync_retention_state(id,min_available_cursor) VALUES ('singleton',0)",
  );
  for (const phase of ['expired', 'live']) {
    const expired = phase === 'expired';
    const expiry = new Date(Date.now() + (expired ? -1 : 1) * 86400000);
    const old = new Date(Date.now() - (expired ? 100 : 1) * 86400000);
    const key = (kind: string) => `users/owned-maintenance/${kind}/${phase}`;
    const keys = [key('package'), key('source'), key('asset'), key('reference'), key('queued')];
    (expired ? expiredKeys : liveKeys).push(...keys);
    await pool.query(
      `INSERT INTO design_scheme_package_stages
      (id,user_id,request_id,request_hash,package_hash,byte_size,format_version,parser_version,object_key,status,authority_hash,expires_at,preview,confirmation_hash)
      VALUES ($1,'owned-maintenance',$1,repeat('a',64),repeat('b',64),4,2,1,$2,'ready',repeat('c',64),$3,'{}',repeat('f',64))`,
      [`package-${phase}`, key('package'), expiry],
    );
    for (const kind of ['package', 'reference']) {
      await pool.query(
        `INSERT INTO generation_reference_uploads(id,user_id,object_key,original_name,mime_type,byte_size,status,expires_at)
        VALUES ($1,'owned-maintenance',$2,'Owned source','application/octet-stream',4,'available',$3)`,
        [`${kind}-${phase}`, key(kind), expiry],
      );
    }
    await pool.query(
      `INSERT INTO design_scheme_source_packages(id,user_id,kind) VALUES ($1,'owned-maintenance','github')`,
      [`source-${phase}`],
    );
    await pool.query(
      `INSERT INTO design_scheme_source_snapshots(id,user_id,package_id,resolved_ref) VALUES ($1,'owned-maintenance',$1,repeat('d',40))`,
      [`source-${phase}`],
    );
    await pool.query(
      `INSERT INTO design_scheme_source_files(snapshot_id,user_id,relative_path,kind,size_bytes,content_hash,object_key)
      VALUES ($1,'owned-maintenance','SKILL.md','text',4,repeat('e',64),$2)`,
      [`source-${phase}`, key('source')],
    );
    await pool.query(
      `INSERT INTO design_scheme_source_preparations(user_id,execution_id,confirmation_id,request_hash,request,status,snapshot_id,content_hash,confirmation,expires_at)
      VALUES ('owned-maintenance',$1,$1,repeat('a',64),'{}','ready',$1,repeat('e',64),'{}',$2)`,
      [`source-${phase}`, expiry],
    );
    await pool.query(
      `INSERT INTO session(id,user_id,token,expires_at) VALUES ($1,'owned-maintenance',$1,now()+interval '1 day')`,
      [`recovery-${phase}`],
    );
    await pool.query(
      `INSERT INTO account_recovery_requests(id,session_id,target_user_id,upstream_issuer,upstream_owner_id,candidate_ciphertext,candidate_summary,reason,identity_version,status,expires_at)
      VALUES ($1,$1,'owned-maintenance','https://upstream.example.test','101','synthetic-candidate-ciphertext','{}','legacy_evidence_missing',0,'pending',$2)`,
      [`recovery-${phase}`, expiry],
    );
    await pool.query(
      `INSERT INTO account_recovery_backup_evidence(id,request_id,target_user_id,upstream_issuer,source_profile_id,source_digest,provenance,ciphertext,state,expires_at)
      VALUES ($1,$1,'owned-maintenance','https://upstream.example.test','owned-profile',repeat('f',64),'{"owned":true}','synthetic-backup-ciphertext','staged',$2)`,
      [`recovery-${phase}`, expiry],
    );
    await pool.query(
      `INSERT INTO rate_limit_buckets(bucket_key,window_started_at,updated_at) VALUES ($1,$2,$2)`,
      [phase, old],
    );
    await pool.query(
      `INSERT INTO generation_runs(id,user_id,status,request,deleted_at,cost_points) VALUES ($1,'owned-maintenance','succeeded','{}',$2,2)`,
      [`run-${phase}`, old],
    );
    await pool.query(
      `INSERT INTO generation_assets(id,run_id,user_id,object_key,mime_type,width,height,byte_size,checksum_sha256,position)
      VALUES ($1,$2,'owned-maintenance',$3,'image/png',1,1,4,repeat('a',64),0)`,
      [`asset-${phase}`, `run-${phase}`, key('asset')],
    );
    await pool.query(
      `INSERT INTO prompts(id,user_id,title,content,deleted_at) VALUES ($1,'owned-maintenance','Owned title','Owned content',$2)`,
      [`prompt-${phase}`, old],
    );
    await pool.query(
      `INSERT INTO prompt_usage_events(user_id,event_id,prompt_id,action) VALUES ('owned-maintenance',$1,$2,'copy')`,
      [phase, `prompt-${phase}`],
    );
    await pool.query(
      `INSERT INTO sync_change_log(user_id,entity_type,entity_id,operation,version,snapshot,created_at)
      VALUES ('owned-maintenance','prompt',$1,'delete',1,'{}',$2)`,
      [`prompt-${phase}`, old],
    );
    await pool.query(
      `INSERT INTO sync_mutation_results(user_id,device_id,mutation_id,entity_type,entity_id,result_status,created_at)
      VALUES ('owned-maintenance','owned-device',$1,'prompt',$2,'applied',$3)`,
      [phase, `prompt-${phase}`, old],
    );
    await pool.query(
      `INSERT INTO object_cleanup_queue(object_key,owner_id,object_type,reason,next_attempt_at)
      VALUES ($1,'owned-maintenance','generation_reference','reference_expired',$2)`,
      [key('queued'), expiry],
    );
  }
  await pool.query(`INSERT INTO sync_devices(user_id,device_id,name,platform,client_version)
    VALUES ('owned-maintenance','owned-device','Owned','macos','2.5.0')`);
  return { expiredKeys, liveKeys };
}
