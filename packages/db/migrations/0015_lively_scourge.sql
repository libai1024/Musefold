CREATE TABLE "design_scheme_text_calls" (
	"user_id" text NOT NULL,
	"execution_id" varchar(64) NOT NULL,
	"ordinal" integer NOT NULL,
	"role" varchar(12) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"prompt" jsonb NOT NULL,
	"status" varchar(12) NOT NULL,
	"lease_until" timestamp with time zone NOT NULL,
	"output" jsonb,
	"usage" jsonb,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "design_scheme_text_calls_user_id_execution_id_ordinal_pk" PRIMARY KEY("user_id","execution_id","ordinal"),
	CONSTRAINT "scheme_text_call_ordinal" CHECK ("design_scheme_text_calls"."ordinal" >= 0 AND "design_scheme_text_calls"."ordinal" < 17),
	CONSTRAINT "scheme_text_call_role" CHECK ("design_scheme_text_calls"."role" IN ('analyst','compiler')),
	CONSTRAINT "scheme_text_call_status" CHECK ("design_scheme_text_calls"."status" IN ('sent','completed','invalid','unknown')),
	CONSTRAINT "scheme_text_call_output" CHECK (("design_scheme_text_calls"."status" = 'completed' AND "design_scheme_text_calls"."output" IS NOT NULL AND "design_scheme_text_calls"."completed_at" IS NOT NULL) OR ("design_scheme_text_calls"."status" <> 'completed' AND "design_scheme_text_calls"."output" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "design_scheme_text_executions" (
	"user_id" text NOT NULL,
	"execution_id" varchar(64) NOT NULL,
	"auth_session_id" text NOT NULL,
	"auth_revision" integer NOT NULL,
	"authorization" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "design_scheme_text_executions_user_id_execution_id_pk" PRIMARY KEY("user_id","execution_id"),
	CONSTRAINT "scheme_text_auth_revision_positive" CHECK ("design_scheme_text_executions"."auth_revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "design_scheme_text_calls" ADD CONSTRAINT "scheme_text_call_execution_fk" FOREIGN KEY ("user_id","execution_id") REFERENCES "public"."design_scheme_text_executions"("user_id","execution_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_scheme_text_executions" ADD CONSTRAINT "scheme_text_execution_parent_fk" FOREIGN KEY ("user_id","execution_id") REFERENCES "public"."design_scheme_agent_sessions"("user_id","execution_id") ON DELETE cascade ON UPDATE no action;