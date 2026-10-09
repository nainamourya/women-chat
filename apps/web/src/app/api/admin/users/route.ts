import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAllowedAdminEmail } from "@/lib/admin";

// Defense in depth only — the Express API independently re-verifies the
// acting user's role from the database (see assertAdmin in auth.service.ts)
// rather than trusting this check or any client-supplied role claim.
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "admin" || !isAllowedAdminEmail(session.user.email)) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  const search = new URL(req.url).searchParams.get("search");
  const query = new URLSearchParams({ adminUserId: session.user.id });
  if (search) query.set("search", search);

  const res = await fetch(`${process.env.SERVER_URL}/api/admin/users?${query.toString()}`, {
    headers: { "x-internal-api-secret": process.env.INTERNAL_API_SECRET! },
    cache: "no-store",
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
