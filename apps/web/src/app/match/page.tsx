import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { MatchClient } from "./MatchClient";

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
      <h1 className="mb-1 text-2xl font-semibold">Find someone to chat with</h1>
      <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">
        You&apos;ll be randomly paired with another eligible user for a
        private text chat.
      </p>

      <div className="mb-6 flex flex-col gap-2 text-sm">
        <div className="flex items-center justify-between rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-800">
          <span>Eligibility verification</span>
          <span
            className={
              eligible
                ? "text-green-700 dark:text-green-400"
                : "text-amber-700 dark:text-amber-400"
            }
          >
            {eligible ? "Verified" : "Not verified"}
          </span>
        </div>
        <div className="flex items-center justify-between rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-800">
          <span>Profile</span>
          <span
            className={
              profileComplete
                ? "text-green-700 dark:text-green-400"
                : "text-amber-700 dark:text-amber-400"
            }
          >
            {profileComplete ? "Complete" : "Incomplete"}
          </span>
        </div>
      </div>

      {eligible ? (
        <MatchClient />
      ) : (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300">
          Complete{" "}
          <Link href="/eligibility" className="underline">
            eligibility verification
          </Link>{" "}
          before matchmaking.
        </p>
      )}
    </main>
  );
}
