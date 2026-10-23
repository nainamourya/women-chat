"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { Logo } from "./Logo";
import { AccountMenu } from "./AccountMenu";
import { useUnreadCounts } from "@/lib/social/unreadCounts";

function Badge({ count, label }: { count: number; label: string }) {
  if (count <= 0) return null;
  return (
    <span aria-label={`${count} unread ${label}`} className="absolute -right-2 -top-1.5 inline-flex min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-4 text-accent-foreground">
      {count > 99 ? "99+" : count}
    </span>
  );
}

export function SiteHeader() {
  const { data: session, status } = useSession();
  const authed = status === "authenticated" && Boolean(session);
  const counts = useUnreadCounts(authed);

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-surface/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-x-4 px-5 py-3.5 sm:px-6">
        <Link href={authed ? "/feed" : "/"} className="flex items-center">
          <Logo />
        </Link>

        {authed && session ? (
          <div className="flex items-center gap-x-5">
            <nav className="hidden items-center gap-x-5 text-sm text-foreground sm:flex" aria-label="Main">
              <Link href="/feed" className="hover:text-brand">
                Home
              </Link>
              <Link href="/discover" className="hover:text-brand">
                Discover
              </Link>
              <Link href="/messages" className="relative hover:text-brand">
                Messages
                <Badge count={counts.messages} label="messages" />
              </Link>
              <Link href="/match" className="hover:text-brand">
                Find someone
              </Link>
              <Link href="/eligibility" className="hover:text-brand">
                Eligibility
              </Link>
            </nav>
            <Link href="/notifications" aria-label="Notifications" className="relative text-foreground hover:text-brand">
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 9a6 6 0 1 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9zM10 19a2 2 0 0 0 4 0" />
              </svg>
              <Badge count={counts.notifications} label="notifications" />
            </Link>
            <AccountMenu session={session} />
          </div>
        ) : (
          <div className="flex items-center gap-x-6">
            <nav className="hidden items-center gap-x-5 text-sm text-foreground sm:flex">
              <Link href="/#how-it-works" className="hover:text-brand">
                How it works
              </Link>
              <Link href="/#safety" className="hover:text-brand">
                Safety &amp; privacy
              </Link>
            </nav>
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
          </div>
        )}
      </div>
    </header>
  );
}
