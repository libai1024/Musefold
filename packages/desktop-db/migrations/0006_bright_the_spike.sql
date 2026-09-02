PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_cloud_sync_accounts` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`device_id` text NOT NULL,
	`device_name` text NOT NULL,
	`platform` text NOT NULL,
	`client_version` text NOT NULL,
	`active` integer DEFAULT 0 NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`consent_state` text DEFAULT 'unset' NOT NULL,
	`consent_decided_at` integer,
	`consent_version` integer DEFAULT 1 NOT NULL,
	`cursor` text DEFAULT '0' NOT NULL,
	`bootstrap_completed_at` integer,
	`last_sync_at` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "cloud_sync_accounts_platform_check" CHECK("__new_cloud_sync_accounts"."platform" IN ('macos', 'windows', 'linux')),
	CONSTRAINT "cloud_sync_accounts_active_check" CHECK("__new_cloud_sync_accounts"."active" IN (0, 1)),
	CONSTRAINT "cloud_sync_accounts_enabled_check" CHECK("__new_cloud_sync_accounts"."enabled" IN (0, 1)),
	CONSTRAINT "cloud_sync_accounts_cursor_check" CHECK("__new_cloud_sync_accounts"."cursor" GLOB '[0-9]*'),
	CONSTRAINT "cloud_sync_accounts_consent_state_check" CHECK("__new_cloud_sync_accounts"."consent_state" IN ('unset', 'enabled', 'paused')),
	CONSTRAINT "cloud_sync_accounts_consent_version_check" CHECK("__new_cloud_sync_accounts"."consent_version" > 0)
);
--> statement-breakpoint
INSERT INTO `__new_cloud_sync_accounts`("owner_id", "username", "device_id", "device_name", "platform", "client_version", "active", "enabled", "consent_state", "consent_decided_at", "consent_version", "cursor", "bootstrap_completed_at", "last_sync_at", "last_error", "created_at", "updated_at") SELECT "owner_id", "username", "device_id", "device_name", "platform", "client_version", "active", "enabled", "consent_state", "consent_decided_at", "consent_version", "cursor", "bootstrap_completed_at", "last_sync_at", "last_error", "created_at", "updated_at" FROM `cloud_sync_accounts`;--> statement-breakpoint
DROP TABLE `cloud_sync_accounts`;--> statement-breakpoint
ALTER TABLE `__new_cloud_sync_accounts` RENAME TO `cloud_sync_accounts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_cloud_sync_one_active_account` ON `cloud_sync_accounts` (`active`) WHERE active = 1;--> statement-breakpoint
CREATE UNIQUE INDEX `cloud_sync_accounts_owner_id_device_id_unique` ON `cloud_sync_accounts` (`owner_id`,`device_id`);