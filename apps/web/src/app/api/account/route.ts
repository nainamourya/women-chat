import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

// Deletes the SIGNED-IN member's own account, and only theirs: the user id is
// taken from the session here, never from the request. The browser supplies
// the typed confirmation and (for accounts that have one) the password, which
// the server checks before anything is erased.
export async function DELETE(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // A request from another site is refused outright (defence in depth on top
  // of the session cookie's SameSite setting).
  const origin = req.headers.get("origin");
  if (origin) {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    let sameSite = false;
    try {
      sameSite = new URL(origin).host === host;
    } catch {
      sameSite = false;
    }
    if (!sameSite) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { confirmation?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (typeof body.confirmation !== "string" || (body.password !== undefined && typeof body.password !== "string")) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  let res: Response;
  try {
    res = await fetch(`${process.env.SERVER_URL}/api/account`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        "x-internal-api-secret": process.env.INTERNAL_API_SECRET!,
      },
      body: JSON.stringify({ userId: session.user.id, confirmation: body.confirmation, password: body.password }),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "The service is unavailable right now. Please try again." }, { status: 502 });
  }

  const data = await res.json().catch(() => ({ error: "Something went wrong." }));
  const headers = new Headers();
  const retryAfter = res.headers.get("retry-after");
  if (retryAfter) headers.set("retry-after", retryAfter);
  return NextResponse.json(data, { status: res.status, headers });
}
