import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { ConfirmAgeClient } from "./ConfirmAgeClient";

export default async function ConfirmAgePage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  if (session.user.ageConfirmed18) {
    redirect("/eligibility");
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      <h1 className="mb-1 text-2xl font-semibold">Before you continue</h1>
      <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">
        This platform is for adult women (18+) only. Please confirm the
        following to continue.
      </p>

      <ConfirmAgeClient />
    </main>
  );
}
