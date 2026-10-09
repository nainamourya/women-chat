import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

// Always uses the session's own user id as the blocker (never client-supplied).
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();

  const res = await fetch(`${process.env.SERVER_URL}/api/blocks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-api-secret": process.env.INTERNAL_API_SECRET!,
    },
    body: JSON.stringify({ blockerUserId: session.user.id, blockedUserId: body.blockedUserId }),
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

export async function DELETE(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();

  const res = await fetch(`${process.env.SERVER_URL}/api/blocks`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      "x-internal-api-secret": process.env.INTERNAL_API_SECRET!,
    },
    body: JSON.stringify({ blockerUserId: session.user.id, blockedUserId: body.blockedUserId }),
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
