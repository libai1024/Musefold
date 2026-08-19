import type { ColumnType, Generated } from "kysely";

type Timestamp = ColumnType<Date, Date | string, Date | string>;

export interface CloudAccountsTable {
  owner_id: string;
  username_snapshot: string;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  deletion_requested_at: Timestamp | null;
}

export interface WebSessionsTable {
  id_hash: string;
  owner_id: string;
  username_snapshot: string;
  credentials_ciphertext: Buffer;
  nonce: Buffer;
  auth_tag: Buffer;
  key_version: number;
  access_expires_at: Timestamp;
  csrf_nonce: string;
  created_at: Generated<Timestamp>;
  last_seen_at: Generated<Timestamp>;
  absolute_expires_at: Timestamp;
  revoked_at: Timestamp | null;
}

export interface AccountCredentialsTable {
  owner_id: string;
  provider: string;
  credential_ciphertext: Buffer;
  nonce: Buffer;
  auth_tag: Buffer;
  key_version: number;
  external_token_id: string | null;
  created_at: Generated<Timestamp>;
  rotated_at: Timestamp;
}

export interface WorkerHeartbeatsTable {
  worker_id: string;
  worker_kind: string;
  version: string;
  started_at: Timestamp;
  heartbeat_at: Timestamp;
}

export interface RateLimitBucketsTable {
  key_hash: string;
  tokens: number;
  updated_at: Timestamp;
  expires_at: Timestamp;
}

export interface PromptFoldersTable {
  owner_id: string;
  id: string;
  name: string;
  normalized_name: string;
  parent_id: string | null;
  sort_order: number;
  version: number;
  created_at: Timestamp;
  updated_at: Timestamp;
  deleted_at: Timestamp | null;
}

export interface PromptTagsTable {
  owner_id: string;
  id: string;
  name: string;
  normalized_name: string;
  tag_group: string | null;
  color: string | null;
  version: number;
  created_at: Timestamp;
  updated_at: Timestamp;
  deleted_at: Timestamp | null;
}

export interface PromptsTable {
  owner_id: string;
  id: string;
  title: string;
  description: string | null;
  content: string;
  negative: string | null;
  folder_id: string | null;
  model_id: string | null;
  params: Record<string, unknown> | null;
  rating: number;
  is_pinned: boolean;
  pin_order: number | null;
  usage_count: number;
  last_used_at: Timestamp | null;
  source: string;
  source_url: string | null;
  version: number;
  created_at: Timestamp;
  updated_at: Timestamp;
  deleted_at: Timestamp | null;
}

export interface PromptTagLinksTable {
  owner_id: string;
  prompt_id: string;
  tag_id: string;
  created_at: Generated<Timestamp>;
}

export interface PromptUsageEventsTable {
  id: Generated<string>;
  owner_id: string;
  prompt_id: string;
  action: string;
  idempotency_key: string | null;
  generation_run_id: string | null;
  created_at: Generated<Timestamp>;
}

export interface SyncChangesTable {
  seq: Generated<string>;
  owner_id: string;
  entity_type: string;
  entity_id: string;
  operation: string;
  entity_version: number;
  snapshot: Record<string, unknown>;
  created_at: Generated<Timestamp>;
}

export interface SyncDevicesTable {
  owner_id: string;
  id: string;
  name: string;
  platform: string;
  client_version: string;
  last_pull_seq: string;
  last_seen_at: Timestamp;
  revoked_at: Timestamp | null;
}

export interface SyncMutationsTable {
  owner_id: string;
  device_id: string;
  mutation_id: string;
  entity_type: string;
  entity_id: string;
  result_status: string;
  result_version: number | null;
  result_snapshot: Record<string, unknown> | null;
  error_code: string | null;
  created_at: Generated<Timestamp>;
}

export interface SyncRetentionStateTable {
  owner_id: string;
  min_available_cursor: string;
  updated_at: Timestamp;
}

export interface WorkbenchSessionsTable {
  owner_id: string;
  id: string;
  title: string;
  draft_prompt: string;
  draft_negative: string;
  draft_params: Record<string, unknown>;
  prompt_reference_ids: string[];
  version: number;
  created_at: Timestamp;
  updated_at: Timestamp;
  archived_at: Timestamp | null;
  deleted_at: Timestamp | null;
}

export interface GenerationRunsTable {
  owner_id: string;
  id: string;
  session_id: string | null;
  parent_run_id: string | null;
  prompt_id: string | null;
  run_kind: string;
  actor_type: string;
  approval_status: string;
  prompt_snapshot: Record<string, unknown> | null;
  request: Record<string, unknown>;
  provider_model: string | null;
  status: string;
  progress: number;
  idempotency_key: string;
  error_code: string | null;
  error_detail_safe: string | null;
  cost_points: number | null;
  attempt_count: number;
  upstream_request_sent: boolean;
  lease_expires_at: Timestamp | null;
  created_at: Timestamp;
  started_at: Timestamp | null;
  finished_at: Timestamp | null;
  cancelled_at: Timestamp | null;
  deleted_at: Timestamp | null;
  mcp_grant_id: string | null;
  approval_token_hash: string | null;
  approval_expires_at: Timestamp | null;
  approved_at: Timestamp | null;
  skill_id: string | null;
  skill_version: string | null;
  skill_content_hash: string | null;
  skill_inputs: Record<string, unknown> | null;
}

export interface GenerationAssetsTable {
  owner_id: string;
  id: string;
  run_id: string;
  object_key: string;
  mime_type: string;
  width: number;
  height: number;
  byte_size: string;
  checksum_sha256: string;
  created_at: Timestamp;
  deleted_at: Timestamp | null;
}

export interface GenerationEventsTable {
  seq: Generated<string>;
  owner_id: string;
  run_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: Generated<Timestamp>;
}

export interface OAuthClientsTable {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  token_endpoint_auth_method: string;
  client_secret_hash: string | null;
  registration_type: string;
  metadata: Record<string, unknown> | null;
  created_at: Timestamp;
  revoked_at: Timestamp | null;
}

export interface OidcProviderArtifactsTable {
  model: string;
  id: string;
  payload: Record<string, unknown>;
  expires_at: Timestamp | null;
  created_at: Generated<Timestamp>;
  updated_at: Timestamp;
}

export interface OAuthGrantsTable {
  id: string;
  owner_id: string;
  client_id: string;
  scopes: string[];
  mode: string;
  max_points_per_generation: number;
  max_points_per_day: number;
  allowed_model_aliases: string[];
  created_at: Timestamp;
  last_used_at: Timestamp | null;
  suspended_at: Timestamp | null;
  revoked_at: Timestamp | null;
}

export interface OAuthAuthorizationCodesTable {
  code_hash: string;
  grant_id: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  resource: string;
  scopes: string[];
  expires_at: Timestamp;
  used_at: Timestamp | null;
}

export interface OAuthAccessTokensTable {
  token_hash: string;
  grant_id: string;
  owner_id: string;
  client_id: string;
  scopes: string[];
  resource: string;
  expires_at: Timestamp;
  created_at: Timestamp;
  revoked_at: Timestamp | null;
}

export interface OAuthRefreshTokensTable {
  token_hash: string;
  family_id: string;
  grant_id: string;
  previous_hash: string | null;
  expires_at: Timestamp;
  created_at: Timestamp;
  used_at: Timestamp | null;
  revoked_at: Timestamp | null;
}

export interface PublishedSkillsTable {
  id: string;
  version: string;
  title: string;
  summary: string;
  content: string;
  input_schema: Record<string, unknown>;
  content_hash: string;
  status: string;
  created_at: Timestamp;
  published_at: Timestamp | null;
}

export interface McpSpendReservationsTable {
  id: string;
  owner_id: string;
  grant_id: string;
  generation_run_id: string;
  estimated_points: number;
  actual_points: number | null;
  status: string;
  reserved_at: Timestamp;
  settled_at: Timestamp | null;
  released_at: Timestamp | null;
}

export interface MusefoldDatabase {
  "app.cloud_accounts": CloudAccountsTable;
  "auth.web_sessions": WebSessionsTable;
  "auth.account_credentials": AccountCredentialsTable;
  "ops.worker_heartbeats": WorkerHeartbeatsTable;
  "ops.rate_limit_buckets": RateLimitBucketsTable;
  "app.prompt_folders": PromptFoldersTable;
  "app.prompt_tags": PromptTagsTable;
  "app.prompts": PromptsTable;
  "app.prompt_tag_links": PromptTagLinksTable;
  "app.prompt_usage_events": PromptUsageEventsTable;
  "app.sync_changes": SyncChangesTable;
  "app.sync_devices": SyncDevicesTable;
  "app.sync_mutations": SyncMutationsTable;
  "app.sync_retention_state": SyncRetentionStateTable;
  "app.workbench_sessions": WorkbenchSessionsTable;
  "app.generation_runs": GenerationRunsTable;
  "app.generation_assets": GenerationAssetsTable;
  "app.generation_events": GenerationEventsTable;
  "auth.oauth_clients": OAuthClientsTable;
  "auth.oauth_grants": OAuthGrantsTable;
  "auth.oauth_authorization_codes": OAuthAuthorizationCodesTable;
  "auth.oauth_access_tokens": OAuthAccessTokensTable;
  "auth.oauth_refresh_tokens": OAuthRefreshTokensTable;
  "auth.oidc_provider_artifacts": OidcProviderArtifactsTable;
  "app.published_skills": PublishedSkillsTable;
  "app.mcp_spend_reservations": McpSpendReservationsTable;
}
