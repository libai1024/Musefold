CREATE TABLE "object_inventory_candidates" (
	"scope_id" varchar(64) NOT NULL,
	"object_key" varchar(512) NOT NULL,
	"prefix" varchar(64) NOT NULL,
	"etag" varchar(256) NOT NULL,
	"modified_at" timestamp with time zone NOT NULL,
	"byte_size" bigint NOT NULL,
	"first_observed_at" timestamp with time zone NOT NULL,
	"last_observed_at" timestamp with time zone NOT NULL,
	"eligible_at" timestamp with time zone NOT NULL,
	CONSTRAINT "object_inventory_candidates_scope_id_object_key_pk" PRIMARY KEY("scope_id","object_key"),
	CONSTRAINT "object_inventory_size_check" CHECK ("object_inventory_candidates"."byte_size" >= 0)
);
--> statement-breakpoint
CREATE TABLE "object_inventory_cursors" (
	"scope_id" varchar(64) NOT NULL,
	"prefix" varchar(64) NOT NULL,
	"mode" varchar(16) NOT NULL,
	"continuation_token" text,
	"lease_token" varchar(64),
	"lease_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "object_inventory_cursors_scope_id_prefix_mode_pk" PRIMARY KEY("scope_id","prefix","mode"),
	CONSTRAINT "object_inventory_cursor_mode_check" CHECK ("object_inventory_cursors"."mode" IN ('record','dry-run'))
);
--> statement-breakpoint
CREATE INDEX "object_inventory_candidates_due_idx" ON "object_inventory_candidates" USING btree ("scope_id","eligible_at");