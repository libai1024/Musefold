CREATE TABLE `local_asset_cleanup` (
	`path` text PRIMARY KEY NOT NULL,
	`device` text,
	`inode` text,
	`state` text NOT NULL,
	`created_at` integer NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`last_error` text
);
--> statement-breakpoint
CREATE INDEX `idx_local_asset_cleanup_due` ON `local_asset_cleanup` (`state`,`next_attempt_at`);