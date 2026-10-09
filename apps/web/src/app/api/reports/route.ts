import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

// Always uses the session's own user id as the reporter (never client-supplied),
// so a signed-in user can only ever file a report as themselves.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();

  const res = await fetch(`${process.env.SERVER_URL}/api/reports`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-api-secret": process.env.INTERNAL_API_SECRET!,
    },
    body: JSON.stringify({ ...body, reporterUserId: session.user.id }),
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
