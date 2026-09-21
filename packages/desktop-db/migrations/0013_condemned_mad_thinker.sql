CREATE TABLE `managed_run_children` (
	`request_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`original_job_id` text NOT NULL,
	`remote_key` text NOT NULL,
	`call_id` text,
	`local_generation_id` text,
	`record_json` text NOT NULL,
	PRIMARY KEY(`request_id`, `ordinal`),
	FOREIGN KEY (`request_id`) REFERENCES `managed_run_requests`(`request_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`call_id`) REFERENCES `automation_spend_calls`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "managed_run_child_json" CHECK(json_valid("managed_run_children"."record_json")),
	CONSTRAINT "managed_run_child_identity" CHECK(
      json_extract("managed_run_children"."record_json", '$.ordinal') IS "managed_run_children"."ordinal"
      AND json_extract("managed_run_children"."record_json", '$.originalJobId') IS "managed_run_children"."original_job_id"
      AND json_extract("managed_run_children"."record_json", '$.remoteKey') IS "managed_run_children"."remote_key"
      AND json_extract("managed_run_children"."record_json", '$.callId') IS "managed_run_children"."call_id"
      AND json_extract("managed_run_children"."record_json", '$.localGenerationId') IS "managed_run_children"."local_generation_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_managed_run_child_job` ON `managed_run_children` (`request_id`,`original_job_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_managed_run_child_key` ON `managed_run_children` (`remote_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_managed_run_child_call` ON `managed_run_children` (`call_id`) WHERE call_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_managed_run_child_local` ON `managed_run_children` (`local_generation_id`) WHERE local_generation_id IS NOT NULL;--> statement-breakpoint
CREATE TABLE `managed_run_requests` (
	`request_id` text PRIMARY KEY NOT NULL,
	`api_issuer` text NOT NULL,
	`principal_id` text NOT NULL,
	`caller_key` text NOT NULL,
	`run_kind` text NOT NULL,
	`record_json` text NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `automation_spend_requests`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "managed_run_kind" CHECK("managed_run_requests"."run_kind" IN ('run_scheme', 'run_github_skill')),
	CONSTRAINT "managed_run_json" CHECK(json_valid("managed_run_requests"."record_json")),
	CONSTRAINT "managed_run_identity" CHECK(
      json_extract("managed_run_requests"."record_json", '$.requestId') IS "managed_run_requests"."request_id"
      AND json_extract("managed_run_requests"."record_json", '$.callerKey') IS "managed_run_requests"."caller_key"
      AND json_extract("managed_run_requests"."record_json", '$.binding.apiIssuer') IS "managed_run_requests"."api_issuer"
      AND json_extract("managed_run_requests"."record_json", '$.binding.principalId') IS "managed_run_requests"."principal_id"
      AND json_extract("managed_run_requests"."record_json", '$.run.runKind') IS "managed_run_requests"."run_kind")
);
