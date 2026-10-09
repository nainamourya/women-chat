import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { EligibilityClient } from "./EligibilityClient";
import { Mascot } from "@/components/Mascot";

export default async function EligibilityPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  if (!session.user.ageConfirmed18) {
    redirect("/confirm-age");
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      <Mascot mood="wave" size="sm" className="mb-3 self-start" />
      <h1 className="mb-1 text-2xl font-semibold text-foreground">Eligibility verification</h1>
      <p className="mb-6 text-sm text-muted">
        This is a <strong className="text-foreground">prototype/test flow</strong> only. It does not
        perform any real identity, age, or gender verification, and no
        identity documents are collected or stored here. A real third-party
        verification provider will replace this step before public launch.
      </p>

      <EligibilityClient initialStatus={session.user.verificationStatus} />
    </main>
  );
}
