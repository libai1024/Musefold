CREATE TABLE `workbench_drafts` (
	`session_id` text PRIMARY KEY NOT NULL,
	`draft_json` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `workbench_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
