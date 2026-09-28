import { NextResponse } from "next/server";

// Proxies to the Express API so the browser never talks to the server
// directly (avoids CORS and keeps INTERNAL_API_SECRET server-side only).
export async function POST(req: Request) {
  const body = await req.json();

  const res = await fetch(`${process.env.SERVER_URL}/api/auth/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-api-secret": process.env.INTERNAL_API_SECRET!,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
