"use client";

import { useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { motion } from "framer-motion";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Alert } from "@/components/ui/Alert";
import type { VerificationStatus } from "@/types/next-auth";

// Client-side pre-check only, kept in sync by hand with the Express server's
// VERIFICATION_VIDEO_MAX_BYTES / VERIFICATION_VIDEO_MAX_DURATION_SECONDS
// defaults (env.ts). The server independently re-validates both — see
// videoStorage.ts, which reads the real container duration via
// music-metadata rather than trusting this check. This client-side copy
// only improves the UX of catching an obviously oversized/too-long file
// before spending time uploading it.
const MAX_VIDEO_BYTES = 25 * 1024 * 1024;
const MAX_VIDEO_SECONDS = 15;
const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];

const statusCopy: Record<VerificationStatus, string> = {
  unverified: "Not started",
  pending: "Submitted — awaiting manual review",
  verified: "Verified",
  rejected: "Not approved",
  resubmission_required: "Resubmission requested",
};

const statusBadgeVariant: Record<VerificationStatus, "neutral" | "warning" | "success" | "danger"> = {
  unverified: "neutral",
  pending: "warning",
  verified: "success",
  rejected: "danger",
  resubmission_required: "warning",
};

const rejectionReasonCopy: Record<string, string> = {
  video_unclear_or_incomplete: "The video was unclear or incomplete.",
  duration_or_format_invalid: "The video's length or format didn't meet the requirements.",
  does_not_meet_guidelines: "The video didn't meet our submission guidelines.",
  other: "The reviewer noted an issue with this submission.",
};

type Submission = {
  id: string;
  status: VerificationStatus;
  rejectionReason: string | null;
  createdAt: string;
};

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// Reads the video's own duration metadata in the browser without uploading
// it anywhere — an off-DOM <video> element is enough to probe this.
function readVideoDurationSeconds(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(video.src);
      resolve(video.duration);
    };
    video.onerror = () => {
      URL.revokeObjectURL(video.src);
      reject(new Error("Could not read video metadata."));
    };
    video.src = URL.createObjectURL(file);
  });
}

export function EligibilityClient({
  initialStatus,
  initialSubmission,
}: {
  initialStatus: VerificationStatus;
  initialSubmission: Submission | null;
}) {
  const { update } = useSession();
  // Prefer the freshly-fetched submission's status over the session's
  // verificationStatus claim: the session comes from the sign-in JWT and
  // only updates on login or an explicit update() call, so it goes stale
  // the moment an admin reviews a submission while the applicant stays
  // signed in — the submission record (re-fetched on every page load in
  // page.tsx) always reflects the latest decision.
  const [status, setStatus] = useState<VerificationStatus>(initialSubmission?.status ?? initialStatus);
  const [submission, setSubmission] = useState<Submission | null>(initialSubmission);
  const [acknowledged, setAcknowledged] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function resetFilePicker() {
    setFile(null);
    setFileError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleFileChange(selected: File | null) {
    setSubmitError(null);
    setFileError(null);
    setFile(null);
    if (!selected) return;

    if (!ALLOWED_VIDEO_TYPES.includes(selected.type)) {
      setFileError("Video must be MP4, WebM, or MOV.");
      return;
    }
    if (selected.size > MAX_VIDEO_BYTES) {
      setFileError(`Video must be under ${Math.floor(MAX_VIDEO_BYTES / (1024 * 1024))}MB.`);
      return;
    }

    try {
      const duration = await readVideoDurationSeconds(selected);
      // Rounded before comparing — see the matching server-side check in
      // videoStorage.ts for why (real encoders rarely hit an exact
      // whole-second duration).
      if (Number.isFinite(duration) && Math.round(duration) > MAX_VIDEO_SECONDS) {
        setFileError(`Video must be ${MAX_VIDEO_SECONDS} seconds or shorter.`);
        return;
      }
    } catch {
      setFileError("Couldn't read this video file. Please try a different file.");
      return;
    }

    setFile(selected);
  }

  async function handleSubmit() {
    if (!acknowledged) {
      setSubmitError("Please acknowledge the notice above before uploading.");
      return;
    }
    if (!file) {
      setSubmitError("Please choose a video to upload.");
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    try {
      const videoBase64 = await readFileAsBase64(file);
      const res = await fetch("/api/verification/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoBase64,
          mimeType: file.type,
          acknowledgedNotice: acknowledged,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setSubmitError(data.error ?? "Something went wrong.");
        return;
      }

      setSubmission(data.submission);
      setStatus("pending");
      resetFilePicker();
      setAcknowledged(false);
      await update({ verificationStatus: "pending" });
    } catch {
      setSubmitError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = status !== "pending" && status !== "verified";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.1, ease: "easeOut" }}
    >
      <Card className="flex flex-col gap-4 p-6">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-foreground">Current status</span>
          <Badge variant={statusBadgeVariant[status]}>{statusCopy[status]}</Badge>
        </div>

        {status === "pending" && (
          <Alert variant="info">
            Your video is awaiting manual review by our team. You can&apos;t access matchmaking, chat, or calls
            until it&apos;s approved. We&apos;ll update this page as soon as a decision is made.
          </Alert>
        )}

        {status === "verified" && <Alert variant="success">You&apos;re verified. You can now use GiiGirl fully.</Alert>}

        {(status === "rejected" || status === "resubmission_required") && (
          <Alert variant={status === "rejected" ? "danger" : "warning"}>
            {status === "rejected" ? "Your submission wasn't approved." : "Please submit a new video."}
            {submission?.rejectionReason && (
              <> {rejectionReasonCopy[submission.rejectionReason] ?? rejectionReasonCopy.other}</>
            )}
          </Alert>
        )}

        {canSubmit && (
          <div className="flex flex-col gap-4">
            <label className="flex items-start gap-2.5 text-sm text-foreground">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-brand"
              />
              <span>
                I&apos;ve read the notice above and understand my video will be manually reviewed and deleted
                immediately afterward.
              </span>
            </label>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-foreground">Introduction video</label>
              <input
                ref={fileInputRef}
                type="file"
                accept="video/mp4,video/webm,video/quicktime"
                onChange={(e) => void handleFileChange(e.target.files?.[0] ?? null)}
                className="text-sm text-muted"
              />
              {fileError && <span className="text-xs text-danger">{fileError}</span>}
              {file && !fileError && <span className="text-xs text-muted">Selected: {file.name}</span>}
            </div>

            {submitError && <Alert variant="danger">{submitError}</Alert>}

            <Button onClick={handleSubmit} disabled={submitting || !acknowledged || !file} className="w-full">
              {submitting ? "Uploading…" : "Submit for review"}
            </Button>
          </div>
        )}
      </Card>
    </motion.div>
  );
}
