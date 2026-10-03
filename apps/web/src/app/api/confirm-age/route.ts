import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

// Same self-attestation as the signup form's checkbox, for accounts (e.g.
// Google sign-in) that skipped that form. Always the session's own user id.
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const res = await fetch(`${process.env.SERVER_URL}/api/auth/confirm-age`, {
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
