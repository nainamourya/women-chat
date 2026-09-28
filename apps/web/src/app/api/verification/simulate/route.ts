import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

// PROTOTYPE / TEST-ONLY. Uses the session's own user id (never a client-
// supplied one) so a signed-in user can only trigger this for themselves.
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const res = await fetch(`${process.env.SERVER_URL}/api/verification/simulate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-api-secret": process.env.INTERNAL_API_SECRET!,
    },
    body: JSON.stringify({ userId: session.user.id }),
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
