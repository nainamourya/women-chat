import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAllowedAdminEmail } from "@/lib/admin";

// Binary passthrough of a report's evidence image — admin-only, never a
// public URL. The Express API independently re-verifies the acting user's
// role from the database before returning the file.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "admin" || !isAllowedAdminEmail(session.user.email)) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }
  const { id } = await params;

  const query = new URLSearchParams({ adminUserId: session.user.id });
  const res = await fetch(`${process.env.SERVER_URL}/api/reports/${id}/evidence?${query.toString()}`, {
    headers: { "x-internal-api-secret": process.env.INTERNAL_API_SECRET! },
    cache: "no-store",
  });

  if (!res.ok) {
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  }

  const buffer = await res.arrayBuffer();
  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": res.headers.get("Content-Type") ?? "application/octet-stream",
      "Cache-Control": "private, no-store",
    },
  });
}
