import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

// Defense in depth only — the Express API independently re-verifies the
// acting user's role from the database (see assertAdmin in auth.service.ts)
// rather than trusting this check or any client-supplied role claim.
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  const status = new URL(req.url).searchParams.get("status");
  const query = new URLSearchParams({ adminUserId: session.user.id });
  if (status) query.set("status", status);

  const res = await fetch(`${process.env.SERVER_URL}/api/reports?${query.toString()}`, {
    headers: { "x-internal-api-secret": process.env.INTERNAL_API_SECRET! },
    cache: "no-store",
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
