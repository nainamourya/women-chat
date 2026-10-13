"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { Logo } from "./Logo";
import { AccountMenu } from "./AccountMenu";
import { useIsAdmin } from "@/lib/useIsAdmin";

export function SiteHeader() {
  const { data: session, status } = useSession();
  const isAdmin = useIsAdmin();

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-surface/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-x-4 px-5 py-3.5 sm:px-6">
        <Link href="/" className="flex items-center">
          <Logo />
        </Link>

        {status === "authenticated" && session ? (
          <div className="flex items-center gap-x-5">
            <nav className="hidden items-center gap-x-5 text-sm text-foreground sm:flex">
              <Link href="/eligibility" className="hover:text-brand">
                Eligibility
              </Link>
              <Link href="/match" className="hover:text-brand">
                Find someone
              </Link>
              {isAdmin && (
                <Link href="/admin" className="hover:text-brand">
                  Admin
                </Link>
              )}
            </nav>
            <AccountMenu session={session} />
          </div>
        ) : (
          <div className="flex items-center gap-x-3 text-sm text-foreground">
            <Link href="/login" className="hover:text-brand">
              Log in
            </Link>
            <Link
              href="/signup"
              className="rounded-full bg-brand px-3.5 py-1.5 text-center text-brand-foreground shadow-sm hover:bg-brand-hover"
            >
              Sign up
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}
