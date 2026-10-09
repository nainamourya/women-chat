import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAllowedAdminEmail } from "@/lib/admin";

// Defense in depth only — the Express API independently re-verifies the
// acting user's role from the database rather than trusting this check.
async function requireAdminSession() {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "admin" || !isAllowedAdminEmail(session.user.email)) {
    return null;
  }
  return session;
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }
  const { id } = await params;
  const body = await req.json();

  const res = await fetch(`${process.env.SERVER_URL}/api/admin/users/${id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "x-internal-api-secret": process.env.INTERNAL_API_SECRET!,
    },
    body: JSON.stringify({ ...body, adminUserId: session.user.id }),
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }
  const { id } = await params;

  const query = new URLSearchParams({ adminUserId: session.user.id });
  const res = await fetch(`${process.env.SERVER_URL}/api/admin/users/${id}?${query.toString()}`, {
    method: "DELETE",
    headers: { "x-internal-api-secret": process.env.INTERNAL_API_SECRET! },
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
