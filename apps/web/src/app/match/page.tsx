import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { MatchClient } from "./MatchClient";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Alert } from "@/components/ui/Alert";
import { Mascot } from "@/components/Mascot";

async function fetchProfileComplete(userId: string): Promise<boolean> {
  const res = await fetch(`${process.env.SERVER_URL}/api/profile/${userId}`, {
    headers: { "x-internal-api-secret": process.env.INTERNAL_API_SECRET! },
    cache: "no-store",
  });
  const data = await res.json();
  return Boolean(data.profile?.profileComplete);
}

export default async function MatchPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  if (!session.user.ageConfirmed18) {
    redirect("/confirm-age");
  }

  const profileComplete = await fetchProfileComplete(session.user.id);
  const eligible = session.user.verificationStatus === "verified";

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      <Mascot mood="wave" size="sm" className="mb-3 self-start" />
      <h1 className="mb-1 text-2xl font-semibold text-foreground">Find someone to chat with</h1>
      <p className="mb-6 text-sm text-muted">
        You&apos;ll be randomly paired with another eligible user for a
        private text chat.
      </p>

      <Card className="mb-6 flex flex-col gap-2 p-4 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-foreground">Eligibility verification</span>
          <Badge variant={eligible ? "success" : "warning"}>
            {eligible ? "Verified" : "Not verified"}
          </Badge>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-foreground">Profile</span>
          <Badge variant={profileComplete ? "success" : "warning"}>
            {profileComplete ? "Complete" : "Incomplete"}
          </Badge>
        </div>
      </Card>

      {eligible ? (
        <MatchClient />
      ) : (
        <Alert variant="warning">
          Complete{" "}
          <Link href="/eligibility" className="underline">
            eligibility verification
          </Link>{" "}
          before matchmaking.
        </Alert>
      )}
    </main>
  );
}
