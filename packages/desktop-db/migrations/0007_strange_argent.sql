CREATE TABLE `automation_budget_periods` (
	`scope_id` text NOT NULL,
	`month` text NOT NULL,
	`opening_points` real DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`scope_id`, `month`),
	FOREIGN KEY (`scope_id`) REFERENCES `automation_spend_policies`(`scope_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `automation_spend_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`kind` text NOT NULL,
	`binding_json` text NOT NULL,
	`input_hash` text NOT NULL,
	`generation_run_id` text,
	`state` text DEFAULT 'pending' NOT NULL,
	`claim_id` text,
	`runtime_epoch` text,
	`started_at` integer,
	`finished_at` integer,
	`reported_points` real,
	`policy_points` real,
	`cost_source` text DEFAULT 'unknown' NOT NULL,
	`evidence_ref` text,
	FOREIGN KEY (`request_id`) REFERENCES `automation_spend_requests`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "automation_spend_call_state" CHECK("automation_spend_calls"."state" IN ('pending', 'started', 'completed', 'unknown', 'not_sent')),
	CONSTRAINT "automation_spend_call_kind" CHECK("automation_spend_calls"."kind" IN ('image', 'text'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_automation_spend_call_order` ON `automation_spend_calls` (`request_id`,`ordinal`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_automation_spend_call_run` ON `automation_spend_calls` (`generation_run_id`) WHERE generation_run_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_automation_spend_call_state` ON `automation_spend_calls` (`request_id`,`state`);--> statement-breakpoint
CREATE TABLE `automation_spend_policies` (
	`scope_id` text PRIMARY KEY NOT NULL,
	`monthly_limit_points` real NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`imported_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `automation_spend_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`scope_id` text NOT NULL,
	`idempotency_key` text,
	`input_hash` text NOT NULL,
	`action` text NOT NULL,
	`caller` text NOT NULL,
	`frozen_input_json` text NOT NULL,
	`bindings_json` text NOT NULL,
	`prompt_text` text,
	`execution_id` text NOT NULL,
	`max_image_calls` integer NOT NULL,
	`max_text_calls` integer NOT NULL,
	`state` text NOT NULL,
	`outcome` text,
	`error_code` text,
	`approval_source` text,
	`confirmation_id` text,
	`confirmation_expires_at` integer,
	`budget_month` text NOT NULL,
	`estimated_points` real,
	`reservation_state` text NOT NULL,
	`reservation_points` real,
	`created_at` integer NOT NULL,
	`authorized_at` integer,
	`finished_at` integer,
	`revision` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`scope_id`) REFERENCES `automation_spend_policies`(`scope_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "automation_spend_request_state" CHECK("automation_spend_requests"."state" IN ('pending_confirmation', 'authorized', 'running', 'terminal')),
	CONSTRAINT "automation_spend_reservation_state" CHECK("automation_spend_requests"."reservation_state" IN ('none', 'held', 'unknown', 'released'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_automation_spend_idempotency` ON `automation_spend_requests` (`scope_id`,`idempotency_key`) WHERE idempotency_key IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_automation_spend_confirmation` ON `automation_spend_requests` (`confirmation_id`) WHERE confirmation_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_automation_spend_execution` ON `automation_spend_requests` (`execution_id`);--> statement-breakpoint
CREATE INDEX `idx_automation_spend_budget` ON `automation_spend_requests` (`scope_id`,`budget_month`,`reservation_state`);--> statement-breakpoint
ALTER TABLE `automation_audit` ADD `automation_request_id` text;--> statement-breakpoint
ALTER TABLE `automation_audit` ADD `event_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_automation_audit_request_event` ON `automation_audit` (`automation_request_id`,`event_key`) WHERE automation_request_id IS NOT NULL AND event_key IS NOT NULL;