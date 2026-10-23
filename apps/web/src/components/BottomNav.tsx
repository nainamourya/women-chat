"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useUnreadCounts } from "@/lib/social/unreadCounts";

type IconProps = { className?: string };

function HomeIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M4 11.5L12 4l8 7.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 10v8a1 1 0 0 0 1 1h3v-5h4v5h3a1 1 0 0 0 1-1v-8" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function SearchIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="m16 16 4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ChatIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M4 11c0-4 3.6-7 8-7s8 3 8 7-3.6 7-8 7c-1 0-2-.15-2.9-.45L5 19.5l1.2-3.6C4.8 14.6 4 12.9 4 11z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ProfileIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="12" cy="8.5" r="3.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M5 19.5c.8-3 3.5-4.5 7-4.5s6.2 1.5 7 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function FindSomeoneIcon({ className }: IconProps) {
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

function NavItem({
  href,
  label,
  icon: Icon,
  active,
  badge = 0,
}: {
  href: string;
  label: string;
  icon: typeof HomeIcon;
  active: boolean;
  badge?: number;
}) {
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className={`relative flex flex-col items-center gap-0.5 px-2 py-1 text-[11px] ${active ? "text-brand" : "text-muted"}`}>
      <span className="relative">
        <Icon className="h-5 w-5" />
        {badge > 0 && (
          <span aria-label={`${badge} unread`} className="absolute -right-2 -top-1.5 inline-flex min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-4 text-accent-foreground">
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </span>
      {label}
    </Link>
  );
}

export function BottomNav() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const authed = status === "authenticated" && Boolean(session);
  const counts = useUnreadCounts(authed);

  if (!authed) return null;
  const on = (prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface/95 backdrop-blur-md sm:hidden">
      <div className="mx-auto flex max-w-3xl items-end justify-around px-2 pb-2 pt-1.5">
        <NavItem href="/feed" label="Home" icon={HomeIcon} active={on("/feed")} />
        <NavItem href="/discover" label="Discover" icon={SearchIcon} active={on("/discover")} />

        <Link href="/match" className="-mt-5 flex flex-col items-center gap-1">
          <span className="flex h-12 w-12 items-center justify-center rounded-full text-white shadow-md" style={{ backgroundImage: "var(--brand-gradient)" }}>
            <FindSomeoneIcon className="h-6 w-6" />
          </span>
          <span className={`text-[11px] ${on("/match") ? "text-brand" : "text-muted"}`}>Find someone</span>
        </Link>

        <NavItem href="/messages" label="Messages" icon={ChatIcon} active={on("/messages")} badge={counts.messages} />
        <NavItem href="/me" label="Profile" icon={ProfileIcon} active={on("/me") || on("/u")} />
      </div>
    </nav>
  );
}
