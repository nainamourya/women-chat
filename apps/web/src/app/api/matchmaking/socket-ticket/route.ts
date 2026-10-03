import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

// Mints a one-time ticket the browser can use to authenticate its direct
// Socket.IO connection to the Express server. Always for the session's own
// user id (never client-supplied) — see socketTickets.ts on the server.
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const res = await fetch(`${process.env.SERVER_URL}/api/matchmaking/socket-ticket`, {
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
