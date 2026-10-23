import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

// The one doorway from the browser to the social API on the Express server.
//
// Who is acting is decided HERE, from the signed-in session, and sent to the
// server in a header that this file builds itself (`x-viewer-id`). Nothing the
// browser sends can set it: client headers are never forwarded, and the
// server's endpoints take no actor id in their paths, queries or bodies.
//
// Only the paths the app actually uses are allowed through, so this proxy is
// not a general tunnel to the internal API.

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const NAME = "[A-Za-z0-9_.]{1,30}";

const ALLOWED: Array<{ methods: string[]; pattern: RegExp }> = [
  { methods: ["GET"], pattern: /^me$/ },
  { methods: ["PUT"], pattern: /^me\/(profile|avatar)$/ },
  { methods: ["DELETE"], pattern: /^me\/avatar$/ },
  { methods: ["GET"], pattern: /^(search|feed|unread-counts|notifications|conversations|blocked)$/ },
  { methods: ["GET"], pattern: new RegExp(`^users/${NAME}$`) },
  { methods: ["GET"], pattern: new RegExp(`^users/${NAME}/(posts|followers|following)$`) },
  { methods: ["POST", "DELETE"], pattern: new RegExp(`^users/${NAME}/(follow|block)$`) },
  { methods: ["POST"], pattern: new RegExp(`^users/${NAME}/report$`) },
  { methods: ["POST"], pattern: /^posts$/ },
  { methods: ["GET", "DELETE"], pattern: new RegExp(`^posts/${UUID}$`) },
  { methods: ["POST", "DELETE"], pattern: new RegExp(`^posts/${UUID}/like$`) },
  { methods: ["GET", "POST"], pattern: new RegExp(`^posts/${UUID}/comments$`) },
  { methods: ["POST"], pattern: new RegExp(`^posts/${UUID}/report$`) },
  { methods: ["DELETE"], pattern: new RegExp(`^comments/${UUID}$`) },
  { methods: ["GET"], pattern: new RegExp(`^media/posts/${UUID}$`) },
  { methods: ["GET"], pattern: new RegExp(`^media/avatars/${NAME}$`) },
  { methods: ["POST"], pattern: /^conversations$/ },
  { methods: ["GET", "POST"], pattern: new RegExp(`^conversations/${UUID}/messages$`) },
  { methods: ["POST"], pattern: new RegExp(`^conversations/${UUID}/read$`) },
  { methods: ["POST"], pattern: /^notifications\/read$/ },
];

const MAX_BODY_BYTES = 8 * 1024 * 1024;

// Browsers send an Origin header on cross-site requests; a state-changing
// request whose Origin is not this site is refused (defence in depth on top of
// the session cookie's SameSite setting).
function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // non-browser caller; still needs the session cookie
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

async function forward(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { path } = await params;
  const joined = path.join("/");
  const method = req.method.toUpperCase();
  const allowed = ALLOWED.some((rule) => rule.methods.includes(method) && rule.pattern.test(joined));
  if (!allowed || path.some((segment) => segment === ".." || segment === ".")) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  if (method !== "GET" && !sameOrigin(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const search = new URL(req.url).search;
  const headers: Record<string, string> = {
    "x-internal-api-secret": process.env.INTERNAL_API_SECRET!,
    "x-viewer-id": session.user.id,
  };

  let body: string | undefined;
  if (method !== "GET" && method !== "DELETE") {
    body = await req.text();
    if (body.length > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "That request is too large." }, { status: 413 });
    }
    headers["Content-Type"] = "application/json";
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${process.env.SERVER_URL}/api/social/${joined}${search}`, {
      method,
      headers,
      body,
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "The service is unavailable right now. Please try again." }, { status: 502 });
  }

  const responseHeaders = new Headers();
  for (const name of ["content-type", "cache-control", "retry-after", "x-content-type-options", "content-security-policy"]) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  return new NextResponse(upstream.body, { status: upstream.status, headers: responseHeaders });
}

export { forward as GET, forward as POST, forward as PUT, forward as DELETE };
