import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

// Catalog is the same for every signed-in user; still gated behind a session
// so the internal API surface stays reachable only from logged-in requests.
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const res = await fetch(`${process.env.SERVER_URL}/api/interests`, {
    headers: { "x-internal-api-secret": process.env.INTERNAL_API_SECRET! },
    cache: "no-store",
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
