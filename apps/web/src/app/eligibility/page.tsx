import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { EligibilityClient } from "./EligibilityClient";
import { Mascot } from "@/components/Mascot";

type Submission = {
  id: string;
  status: "pending_review" | "approved" | "rejected" | "resubmission_required";
  rejectionReason: string | null;
  createdAt: string;
} | null;

async function fetchLatestSubmission(userId: string): Promise<Submission> {
  const res = await fetch(`${process.env.SERVER_URL}/api/verification/video/status/${userId}`, {
    headers: { "x-internal-api-secret": process.env.INTERNAL_API_SECRET! },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.submission ?? null;
}

export default async function EligibilityPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  if (!session.user.ageConfirmed18) {
    redirect("/confirm-age");
  }

  const submission = await fetchLatestSubmission(session.user.id);

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      <Mascot mood="wave" size="sm" className="mb-3 self-start" />
      <h1 className="mb-1 text-2xl font-semibold text-foreground">Eligibility verification</h1>
      <div className="mb-6 flex flex-col gap-2.5 text-sm text-muted">
        <p>
          Before you can use matchmaking, chat, or calls, upload a short introduction video. A member of our
          team manually reviews every submission — there is no automated face, voice, age, or gender analysis.
        </p>
        <p>
          Your video is used only for this one-time review. It is{" "}
          <strong className="text-foreground">permanently deleted immediately after a decision is made</strong>,
          whether you&apos;re approved, rejected, or asked to resubmit. We keep only the decision itself (approved,
          rejected, or resubmission requested), who reviewed it, and when — never the video, and never notes
          about your appearance or voice.
        </p>
        <p>
          A short video can&apos;t conclusively prove your age, gender, or identity, and we don&apos;t claim it
          does — this review exists only to apply a human, good-faith check before you can start using GiiGirl.
        </p>
        <p>
          You don&apos;t need to show an ID, your address, or any other personal document — just introduce
          yourself briefly on camera. If your submission is rejected and you think that was a mistake, or you
          need help at any point, contact support and reference your account email.
        </p>
      </div>

      <EligibilityClient
        initialStatus={session.user.verificationStatus}
        initialSubmission={
          submission
            ? {
                id: submission.id,
                status:
                  submission.status === "pending_review"
                    ? "pending"
                    : submission.status === "approved"
                      ? "verified"
                      : submission.status,
                rejectionReason: submission.rejectionReason,
                createdAt: submission.createdAt,
              }
            : null
        }
      />
    </main>
  );
}
