CREATE TYPE "public"."video_rejection_reason" AS ENUM('video_unclear_or_incomplete', 'duration_or_format_invalid', 'does_not_meet_guidelines', 'other');--> statement-breakpoint
CREATE TYPE "public"."video_verification_status" AS ENUM('pending_review', 'approved', 'rejected', 'resubmission_required');--> statement-breakpoint
ALTER TYPE "public"."verification_status" ADD VALUE 'resubmission_required';--> statement-breakpoint
CREATE TABLE "verification_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "video_verification_status" DEFAULT 'pending_review' NOT NULL,
	"video_storage_key" text,
	"video_deleted_at" timestamp with time zone,
	"video_deletion_pending" boolean DEFAULT false NOT NULL,
	"pending_decision" "video_verification_status",
	"rejection_reason" "video_rejection_reason",
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "verification_submissions" ADD CONSTRAINT "verification_submissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_submissions" ADD CONSTRAINT "verification_submissions_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "verification_submissions_user_id_idx" ON "verification_submissions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_submissions_status_idx" ON "verification_submissions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "verification_submissions_one_pending_per_user" ON "verification_submissions" USING btree ("user_id") WHERE "verification_submissions"."status" = 'pending_review';