CREATE TABLE `managed_execution_checkpoint` (
	`id` integer PRIMARY KEY NOT NULL,
	`lineage_id` text NOT NULL,
	`namespace` text NOT NULL,
	`revision` integer NOT NULL,
	`head_hash` text NOT NULL,
	`last_operation_id` text NOT NULL,
	CONSTRAINT "managed_checkpoint_singleton" CHECK("managed_execution_checkpoint"."id" = 1),
	CONSTRAINT "managed_checkpoint_revision" CHECK(typeof("managed_execution_checkpoint"."revision") = 'integer' AND "managed_execution_checkpoint"."revision" >= 0 AND "managed_execution_checkpoint"."revision" <= 9007199254740991),
	CONSTRAINT "managed_checkpoint_hash" CHECK(length("managed_execution_checkpoint"."head_hash") = 64 AND "managed_execution_checkpoint"."head_hash" NOT GLOB '*[^0-9a-f]*')
);
