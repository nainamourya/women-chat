import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

// Always uses the session's own user id (never client-supplied).
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const res = await fetch(`${process.env.SERVER_URL}/api/matchmaking/status/${session.user.id}`, {
    headers: { "x-internal-api-secret": process.env.INTERNAL_API_SECRET! },
    cache: "no-store",
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
