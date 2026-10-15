import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

// Always looks up the session's own user id (never client-supplied), so a
// signed-in user can only ever check their own verification status.
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const res = await fetch(`${process.env.SERVER_URL}/api/verification/video/status/${session.user.id}`, {
    headers: { "x-internal-api-secret": process.env.INTERNAL_API_SECRET! },
    cache: "no-store",
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
