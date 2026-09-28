import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { EligibilityClient } from "./EligibilityClient";

export default async function EligibilityPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      <h1 className="mb-1 text-2xl font-semibold">Eligibility verification</h1>
      <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">
        This is a <strong>prototype/test flow</strong> only. It does not
        perform any real identity, age, or gender verification, and no
        identity documents are collected or stored here. A real third-party
        verification provider will replace this step before public launch.
      </p>

      <EligibilityClient initialStatus={session.user.verificationStatus} />
    </main>
  );
}
