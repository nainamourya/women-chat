"use client";

import Link from "next/link";
import { useSession, signOut } from "next-auth/react";

export function SiteHeader() {
  const { status } = useSession();

  return (
    <header className="border-b border-zinc-200 dark:border-zinc-800">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
        <Link href="/" className="font-semibold">
          women-chat
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          {status === "authenticated" ? (
            <>
              <Link href="/profile">Profile</Link>
              <Link href="/eligibility">Eligibility</Link>
              <Link href="/match">Find someone</Link>
              <button
                onClick={() => signOut({ callbackUrl: "/" })}
                className="cursor-pointer text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                Log out
              </button>
            </>
          ) : (
            <>
              <Link href="/login">Log in</Link>
              <Link
                href="/signup"
                className="rounded-md bg-zinc-900 px-3 py-1.5 text-white dark:bg-white dark:text-zinc-900"
              >
                Sign up
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
