CREATE TABLE "sync_taxonomy_tombstones" (
	"user_id" text NOT NULL,
	"entity_type" varchar(20) NOT NULL,
	"entity_id" varchar(64) NOT NULL,
	"version" integer NOT NULL,
	"entity_created_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sync_taxonomy_tombstones_user_id_entity_type_entity_id_pk" PRIMARY KEY("user_id","entity_type","entity_id"),
	CONSTRAINT "sync_taxonomy_tombstones_entity_type_check" CHECK ("sync_taxonomy_tombstones"."entity_type" in ('folder', 'tag')),
	CONSTRAINT "sync_taxonomy_tombstones_version_check" CHECK ("sync_taxonomy_tombstones"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "sync_taxonomy_tombstones" ADD CONSTRAINT "sync_taxonomy_tombstones_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;