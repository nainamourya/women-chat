import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

// Every social page requires a signed-in member who has confirmed they are 18+.
// Whether they are also verified (and have a username) is enforced by the API,
// and the page shows the matching prompt — so this is only the first gate.
export async function requireMember(): Promise<{ id: string }> {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!session.user.ageConfirmed18) redirect("/confirm-age");
  return { id: session.user.id };
}
