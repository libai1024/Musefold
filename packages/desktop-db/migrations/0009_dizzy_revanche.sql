CREATE TABLE `managed_generation_requests` (
	`request_id` text PRIMARY KEY NOT NULL,
	`call_id` text,
	`api_issuer` text NOT NULL,
	`principal_id` text NOT NULL,
	`remote_key` text NOT NULL,
	`record_json` text NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `automation_spend_requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`call_id`) REFERENCES `automation_spend_calls`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "managed_generation_json" CHECK(json_valid("managed_generation_requests"."record_json")),
	CONSTRAINT "managed_generation_identity" CHECK(
      json_extract("managed_generation_requests"."record_json", '$.requestId') IS "managed_generation_requests"."request_id"
      AND json_extract("managed_generation_requests"."record_json", '$.callId') IS "managed_generation_requests"."call_id"
      AND json_extract("managed_generation_requests"."record_json", '$.binding.apiIssuer') IS "managed_generation_requests"."api_issuer"
      AND json_extract("managed_generation_requests"."record_json", '$.binding.principalId') IS "managed_generation_requests"."principal_id"
      AND json_extract("managed_generation_requests"."record_json", '$.remoteKey') IS "managed_generation_requests"."remote_key")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_managed_generation_remote` ON `managed_generation_requests` (`api_issuer`,`principal_id`,`remote_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_managed_generation_call` ON `managed_generation_requests` (`call_id`);