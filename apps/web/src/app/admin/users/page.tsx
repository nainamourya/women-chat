import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isAllowedAdminEmail } from "@/lib/admin";
import { AdminUsersClient } from "./AdminUsersClient";

export default async function AdminUsersPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  // The Express API independently re-verifies this from the database on
  // every admin request — this check only keeps non-admins off the page.
  if (session.user.role !== "admin" || !isAllowedAdminEmail(session.user.email)) {
    redirect("/match");
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-10">
      <h1 className="mb-1 text-2xl font-semibold text-foreground">User management</h1>
      <p className="mb-6 text-sm text-muted">
        Search for an account to suspend, unsuspend, block, unblock, or permanently delete it.
      </p>
      <AdminUsersClient />
    </main>
  );
}
