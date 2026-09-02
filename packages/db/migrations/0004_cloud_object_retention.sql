CREATE TABLE "generation_reference_links" (
	"run_id" varchar(64) NOT NULL,
	"reference_id" varchar(64) NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "generation_reference_links_run_id_reference_id_pk" PRIMARY KEY("run_id","reference_id")
);
--> statement-breakpoint
CREATE TABLE "generation_reference_uploads" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"object_key" varchar(512) NOT NULL,
	"original_name" varchar(255) NOT NULL,
	"mime_type" varchar(32) NOT NULL,
	"byte_size" integer NOT NULL,
	"status" varchar(24) DEFAULT 'uploading' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uploaded_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"cleanup_queued_at" timestamp with time zone,
	CONSTRAINT "generation_reference_uploads_id_user_unique" UNIQUE("id","user_id"),
	CONSTRAINT "generation_reference_uploads_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "generation_reference_uploads_byte_size_check" CHECK ("generation_reference_uploads"."byte_size" >= 0),
	CONSTRAINT "generation_reference_uploads_status_check" CHECK ("generation_reference_uploads"."status" IN ('uploading', 'available', 'cleanup_pending'))
);
--> statement-breakpoint
CREATE TABLE "object_cleanup_queue" (
	"object_key" varchar(512) PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"object_type" varchar(32) NOT NULL,
	"reason" varchar(40) NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"last_error" varchar(160),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "object_cleanup_queue_attempt_count_check" CHECK ("object_cleanup_queue"."attempt_count" >= 0),
	CONSTRAINT "object_cleanup_queue_type_check" CHECK ("object_cleanup_queue"."object_type" IN ('generation_asset', 'generation_reference')),
	CONSTRAINT "object_cleanup_queue_reason_check" CHECK ("object_cleanup_queue"."reason" IN ('generation_purge', 'generation_compensation', 'reference_expired', 'reference_upload_failed'))
);
--> statement-breakpoint
ALTER TABLE "generation_runs" ADD CONSTRAINT "generation_runs_id_user_unique" UNIQUE("id","user_id");--> statement-breakpoint
ALTER TABLE "generation_reference_links" ADD CONSTRAINT "generation_reference_links_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_reference_links" ADD CONSTRAINT "generation_reference_links_run_owner_fk" FOREIGN KEY ("run_id","user_id") REFERENCES "public"."generation_runs"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_reference_links" ADD CONSTRAINT "generation_reference_links_reference_owner_fk" FOREIGN KEY ("reference_id","user_id") REFERENCES "public"."generation_reference_uploads"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_reference_uploads" ADD CONSTRAINT "generation_reference_uploads_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "generation_reference_links_user_reference_idx" ON "generation_reference_links" USING btree ("user_id","reference_id");--> statement-breakpoint
CREATE INDEX "generation_reference_uploads_user_status_expiry_idx" ON "generation_reference_uploads" USING btree ("user_id","status","expires_at");--> statement-breakpoint
CREATE INDEX "generation_reference_uploads_cleanup_idx" ON "generation_reference_uploads" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "object_cleanup_queue_due_idx" ON "object_cleanup_queue" USING btree ("next_attempt_at","created_at");--> statement-breakpoint
CREATE INDEX "object_cleanup_queue_owner_idx" ON "object_cleanup_queue" USING btree ("owner_id","object_type");--> statement-breakpoint
WITH legacy_references AS (
	SELECT DISTINCT ON (r."user_id", reference->>'id')
		r."user_id",
		reference->>'id' AS "reference_id",
		left(COALESCE(NULLIF(reference->>'name', ''), 'reference'), 255) AS "original_name",
		CASE
			WHEN reference->>'mimeType' IN ('image/png', 'image/jpeg', 'image/webp') THEN reference->>'mimeType'
			ELSE 'image/png'
		END AS "mime_type",
		CASE
			WHEN reference->>'byteSize' ~ '^\d{1,9}$' THEN LEAST((reference->>'byteSize')::integer, 20971520)
			ELSE 0
		END AS "byte_size",
		r."created_at"
	FROM "generation_runs" r
	CROSS JOIN LATERAL jsonb_array_elements(
		CASE
			WHEN jsonb_typeof(r."request"->'referenceImages') = 'array' THEN r."request"->'referenceImages'
			ELSE '[]'::jsonb
		END
	) AS reference
	WHERE reference->>'id' ~ '^[0-9A-Za-z_-]{8,64}$'
	ORDER BY r."user_id", reference->>'id', r."created_at"
)
INSERT INTO "generation_reference_uploads" (
	"id", "user_id", "object_key", "original_name", "mime_type", "byte_size",
	"status", "created_at", "uploaded_at", "expires_at"
)
SELECT
	"reference_id",
	"user_id",
	'users/' || "user_id" || '/references/' || "reference_id",
	"original_name",
	"mime_type",
	"byte_size",
	'available',
	"created_at",
	"created_at",
	"created_at" + interval '24 hours'
FROM legacy_references
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "generation_reference_links" ("run_id", "reference_id", "user_id", "created_at")
SELECT r."id", reference->>'id', r."user_id", r."created_at"
FROM "generation_runs" r
CROSS JOIN LATERAL jsonb_array_elements(
	CASE
		WHEN jsonb_typeof(r."request"->'referenceImages') = 'array' THEN r."request"->'referenceImages'
		ELSE '[]'::jsonb
	END
) AS reference
JOIN "generation_reference_uploads" upload
	ON upload."id" = reference->>'id' AND upload."user_id" = r."user_id"
ON CONFLICT DO NOTHING;
