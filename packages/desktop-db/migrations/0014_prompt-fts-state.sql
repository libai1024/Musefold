CREATE TABLE `prompt_fts_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`tokenizer_version` integer NOT NULL,
	CONSTRAINT "prompt_fts_state_singleton" CHECK("prompt_fts_state"."id" = 1),
	CONSTRAINT "prompt_fts_state_version" CHECK("prompt_fts_state"."tokenizer_version" >= 1)
);
