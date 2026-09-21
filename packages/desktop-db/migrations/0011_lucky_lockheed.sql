CREATE TABLE `workbench_session_deletions` (
	`id` text PRIMARY KEY NOT NULL,
	`purged_at` integer NOT NULL
);
--> statement-breakpoint
-- Enforce permanent identities for every legacy/import writer as well as the modern store.
CREATE TRIGGER workbench_session_no_recreate BEFORE INSERT ON workbench_sessions
WHEN EXISTS (SELECT 1 FROM workbench_session_deletions WHERE id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'Workbench Session permanently deleted'); END;
--> statement-breakpoint
CREATE TRIGGER workbench_session_no_rekey BEFORE UPDATE OF id ON workbench_sessions
WHEN EXISTS (SELECT 1 FROM workbench_session_deletions WHERE id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'Workbench Session permanently deleted'); END;
