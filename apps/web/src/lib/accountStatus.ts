// Extracted from the NextAuth jwt callback (auth.ts) specifically so it can
// be unit-tested in isolation — by mocking global fetch — without needing a
// database or the full NextAuth() runtime. Checks whether a user's account
// has been deleted, by asking the Express server (the only thing with
// database access from this app). Fails open (returns false) on any
// network/server error, consistent with this project's established
// fail-open convention elsewhere (e.g. rate limiting) — a transient outage
// must not lock every signed-in user out simultaneously.
export async function isAccountDeleted(userId: string): Promise<boolean> {
  try {
    const res = await fetch(`${process.env.SERVER_URL}/api/auth/account-status/${userId}`, {
      headers: { "x-internal-api-secret": process.env.INTERNAL_API_SECRET! },
      cache: "no-store",
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { accountStatus: string };
    return data.accountStatus === "deleted";
  } catch {
    return false;
  }
}
