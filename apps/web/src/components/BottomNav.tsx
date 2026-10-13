"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useIsAdmin } from "@/lib/useIsAdmin";

function HomeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M4 11.5L12 4l8 7.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 10v8a1 1 0 0 0 1 1h3v-5h4v5h3a1 1 0 0 0 1-1v-8" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function EligibilityIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 3l7 3v5c0 4.4-3 8.2-7 9.5-4-1.3-7-5.1-7-9.5V6l7-3z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M9 12.2l2 2 4-4.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FindSomeoneIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 20s-7-4.4-9.3-8.8C1.2 7.8 3 4.5 6.4 4.5c2 0 3.5 1.1 5.6 3 2.1-1.9 3.6-3 5.6-3 3.4 0 5.2 3.3 3.7 6.7C19 15.6 12 20 12 20z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AdminIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 3l7 3v5c0 4.4-3 8.2-7 9.5-4-1.3-7-5.1-7-9.5V6l7-3z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function NavItem({ href, label, icon: Icon, active }: { href: string; label: string; icon: typeof HomeIcon; active: boolean }) {
  return (
    <Link
      href={href}
      className={`flex flex-col items-center gap-0.5 px-2 py-1 text-[11px] ${active ? "text-brand" : "text-muted"}`}
    >
      <Icon className="h-5 w-5" />
      {label}
    </Link>
  );
}

export function BottomNav() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  // Called unconditionally (rules of hooks) even though its result is only
  // used after the early return below.
  const isAdmin = useIsAdmin();

  if (status !== "authenticated" || !session) return null;

  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface/95 backdrop-blur-md sm:hidden">
      <div className="mx-auto flex max-w-3xl items-end justify-around px-2 pb-2 pt-1.5">
        <NavItem href="/" label="Home" icon={HomeIcon} active={pathname === "/"} />
        <NavItem href="/eligibility" label="Eligibility" icon={EligibilityIcon} active={pathname === "/eligibility"} />

        <Link href="/match" className="-mt-5 flex flex-col items-center gap-1">
          <span
            className="flex h-12 w-12 items-center justify-center rounded-full text-white shadow-md"
            style={{ backgroundImage: "linear-gradient(135deg, #6b21a8, #ec4899)" }}
          >
            <FindSomeoneIcon className="h-6 w-6" />
          </span>
          <span className={`text-[11px] ${pathname === "/match" ? "text-brand" : "text-muted"}`}>Find someone</span>
        </Link>

        {isAdmin ? (
          <NavItem href="/admin" label="Admin" icon={AdminIcon} active={pathname === "/admin"} />
        ) : (
          <span className="w-10" aria-hidden="true" />
        )}
      </div>
    </nav>
  );
}
