import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

// Mints the ICE server list (STUN + any configured TURN relay) for the
// session's own user id. TURN credentials are generated server-side and
// never committed to client source — see iceServers.service.ts.
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const res = await fetch(`${process.env.SERVER_URL}/api/ice-servers`, {
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
