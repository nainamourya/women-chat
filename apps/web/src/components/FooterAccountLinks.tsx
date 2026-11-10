"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";

const linkClass = "text-sm text-muted transition-colors hover:text-brand";

// Visitors get Log in; signed-in members get their own account pages instead
// (an "Eligibility status" link means nothing to someone without an account).
export function FooterAccountLinks() {
  const { status } = useSession();

  if (status === "authenticated") {
    return (
      <>
        <Link href="/me" className={linkClass}>My profile</Link>
        <Link href="/eligibility" className={linkClass}>Verification status</Link>
      </>
    );
  }

  return (
    <Link href="/login" className={linkClass}>Log in</Link>
  );
}
