import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

// Browser → Worker doorway for Web Push. Like the social proxy, WHO is acting
// comes only from the signed-in session (`x-viewer-id` is built here), and only
// these three actions exist.
const ACTIONS = {
  "public-key": "GET",
  subscribe: "POST",
  unsubscribe: "POST",
} as const;

const MAX_BODY_BYTES = 4 * 1024;

function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

async function forward(req: Request, { params }: { params: Promise<{ action: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { action } = await params;
  const method = req.method.toUpperCase();
  if (!(action in ACTIONS) || ACTIONS[action as keyof typeof ACTIONS] !== method) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  if (method !== "GET" && !sameOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const headers: Record<string, string> = {
    "x-internal-api-secret": process.env.INTERNAL_API_SECRET!,
    "x-viewer-id": session.user.id,
  };
  let body: string | undefined;
  if (method === "POST") {
    body = await req.text();
    if (body.length > MAX_BODY_BYTES) return NextResponse.json({ error: "That request is too large." }, { status: 413 });
    headers["Content-Type"] = "application/json";
  }

  try {
    const upstream = await fetch(`${process.env.SERVER_URL}/api/push/${action}`, { method, headers, body, cache: "no-store" });
    const data = await upstream.json().catch(() => ({}));
    return NextResponse.json(data, { status: upstream.status, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "The service is unavailable right now. Please try again." }, { status: 502 });
  }
}

export { forward as GET, forward as POST };
