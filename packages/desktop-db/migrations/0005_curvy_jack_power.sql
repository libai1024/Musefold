ALTER TABLE `cloud_sync_accounts` ADD `consent_state` text DEFAULT 'unset' NOT NULL;--> statement-breakpoint
ALTER TABLE `cloud_sync_accounts` ADD `consent_decided_at` integer;--> statement-breakpoint
ALTER TABLE `cloud_sync_accounts` ADD `consent_version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint

-- Classify legacy accounts without treating device metadata as sync evidence.
UPDATE `cloud_sync_accounts`
SET
  consent_state = CASE
    WHEN enabled = 1 THEN 'enabled'
    WHEN bootstrap_completed_at IS NOT NULL
      OR last_sync_at IS NOT NULL
      OR EXISTS (
        SELECT 1 FROM cloud_entity_state state
        WHERE state.owner_id = cloud_sync_accounts.owner_id
      )
      OR EXISTS (
        SELECT 1 FROM cloud_sync_outbox outbox
        WHERE outbox.owner_id = cloud_sync_accounts.owner_id
      )
      OR EXISTS (
        SELECT 1 FROM cloud_sync_usage_outbox usage_outbox
        WHERE usage_outbox.owner_id = cloud_sync_accounts.owner_id
      )
      OR EXISTS (
        SELECT 1 FROM cloud_sync_conflicts conflicts
        WHERE conflicts.owner_id = cloud_sync_accounts.owner_id
          AND conflicts.resolved_at IS NULL
      )
      THEN 'paused'
    ELSE 'unset'
  END,
  consent_decided_at = CASE
    WHEN enabled = 1 OR bootstrap_completed_at IS NOT NULL OR last_sync_at IS NOT NULL
      OR EXISTS (
        SELECT 1 FROM cloud_entity_state state
        WHERE state.owner_id = cloud_sync_accounts.owner_id
      )
      OR EXISTS (
        SELECT 1 FROM cloud_sync_outbox outbox
        WHERE outbox.owner_id = cloud_sync_accounts.owner_id
      )
      OR EXISTS (
        SELECT 1 FROM cloud_sync_usage_outbox usage_outbox
        WHERE usage_outbox.owner_id = cloud_sync_accounts.owner_id
      )
      OR EXISTS (
        SELECT 1 FROM cloud_sync_conflicts conflicts
        WHERE conflicts.owner_id = cloud_sync_accounts.owner_id
          AND conflicts.resolved_at IS NULL
      )
      THEN updated_at
    ELSE NULL
  END,
  consent_version = 1;