import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

// Always deletes the session's own user id — never a client-supplied one —
// same trust model as every other proxy route in this app.
export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const res = await fetch(`${process.env.SERVER_URL}/api/account`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      "x-internal-api-secret": process.env.INTERNAL_API_SECRET!,
    },
    body: JSON.stringify({ userId: session.user.id }),
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
