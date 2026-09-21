import type pg from 'pg';
import { seedMaintenanceMatrix } from './maintenance-matrix.js';

/** Owned SQL records for publication guards; not paid execution authority. */
export async function seedStoragePublicationMatrix(pool: pg.Pool) {
  await seedMaintenanceMatrix(pool);
  await pool.query(`
      INSERT INTO design_schemes(id,user_id,name,current_revision_id,source_presentation,fidelity)
        VALUES('fence-scheme','owned-maintenance','Owned','fence-revision','musefold-created','faithful');
      INSERT INTO design_scheme_revisions(revision_id,scheme_id,user_id,schema_version,document,created_by)
        VALUES('fence-revision','fence-scheme','owned-maintenance',1,'{"revisionId":"fence-revision","schemeId":"fence-scheme"}','user');
      INSERT INTO design_scheme_assets(id,user_id,revision_id,object_key,role,origin,mime_type,width,height,content_hash)
        VALUES('fence-asset','owned-maintenance','fence-revision','scheme-owned-original','reference','uploaded','image/png',1,1,repeat('a',64));
      INSERT INTO design_scheme_generation_references(generation_run_id,user_id,asset_id,position,object_key,name,mime_type,byte_size,content_hash)
        SELECT id,user_id,'fence-input',0,'scheme-owned-input','Owned','image/png',4,repeat('a',64)
        FROM generation_runs LIMIT 1;
      INSERT INTO design_scheme_package_exports(id,user_id,request_id,request_hash,authority_hash,scheme_id,revision_id,expected_version,basis_hash,object_key,status,lease_until,expires_at)
        VALUES('fence-export','owned-maintenance','fence-export',repeat('a',64),repeat('a',64),'fence-scheme','fence-revision',1,repeat('a',64),'scheme-owned-export','preparing',now()+interval '1 day',now()+interval '1 day');
      INSERT INTO design_scheme_package_imports(stage_id,user_id,request_hash,authority_hash,confirmation_hash,parser_version,mapping_version,seed,attempt_id,epoch,status,lease_until)
        VALUES('package-live','owned-maintenance',repeat('a',64),repeat('a',64),repeat('a',64),1,1,'713188f7-5410-488f-a849-5b736df58b45','8cb44d8b-f2a3-4f6c-87d8-e567ce90bfe5',1,'running',now()-interval '1 second');
    `);
}
