"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Session } from "next-auth";
import { signOut } from "next-auth/react";
import { AnimatePresence, motion } from "framer-motion";
import { useIsAdmin } from "@/lib/useIsAdmin";

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M19.4 13.5c.1-.5.1-1 0-1.5l1.6-1.2a.8.8 0 0 0 .2-1l-1.5-2.6a.8.8 0 0 0-.9-.4l-1.8.6a7.6 7.6 0 0 0-1.3-.75l-.3-1.9a.8.8 0 0 0-.8-.65h-3a.8.8 0 0 0-.8.65l-.3 1.9c-.47.19-.9.44-1.3.75l-1.8-.6a.8.8 0 0 0-.9.4L4.8 9.8a.8.8 0 0 0 .2 1l1.6 1.2c-.1.5-.1 1 0 1.5l-1.6 1.2a.8.8 0 0 0-.2 1l1.5 2.6c.2.33.58.47.9.4l1.8-.6c.4.31.83.56 1.3.75l.3 1.9c.07.37.4.65.8.65h3c.4 0 .73-.28.8-.65l.3-1.9c.47-.19.9-.44 1.3-.75l1.8.6c.33.1.72-.07.9-.4l1.5-2.6a.8.8 0 0 0-.2-1l-1.6-1.2z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ProfileIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="12" cy="8.5" r="3.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M4.5 20c1.2-4 4-6 7.5-6s6.3 2 7.5 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function AdminIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 3l7 3v5c0 4.4-3 8.2-7 9.5-4-1.3-7-5.1-7-9.5V6l7-3z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LogoutIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M14 15l4-3-4-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M18 12H9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function MenuLink({
  href,
  icon,
  children,
  onClick,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-foreground hover:bg-surface-hover"
    >
      {icon}
      {children}
    </Link>
  );
}

export function AccountMenu({ session }: { session: Session }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const isAdmin = useIsAdmin();

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const name = session.user.name ?? session.user.email ?? "Account";
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  const close = () => setOpen(false);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold text-brand-foreground"
        style={{ backgroundImage: "var(--brand-gradient)" }}
      >
        {initial}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            role="menu"
            className="absolute right-0 top-full z-30 mt-2 w-60 overflow-hidden rounded-lg border border-border bg-surface shadow-md"
          >
            <div className="px-3.5 py-3">
              <p className="truncate text-sm font-semibold text-foreground">{name}</p>
              <p className="truncate text-xs text-muted">{session.user.email}</p>
            </div>
            <div className="border-t border-border" />
            <div className="flex flex-col gap-0.5 p-1.5">
              <MenuLink href="/profile?tab=settings" icon={<SettingsIcon className="h-4 w-4" />} onClick={close}>
                Settings
              </MenuLink>
              <MenuLink href="/profile" icon={<ProfileIcon className="h-4 w-4" />} onClick={close}>
                Profile
              </MenuLink>
              {isAdmin && (
                <MenuLink href="/admin" icon={<AdminIcon className="h-4 w-4" />} onClick={close}>
                  Admin
                </MenuLink>
              )}
              <button
                type="button"
                onClick={() => {
                  close();
                  signOut({ callbackUrl: "/" });
                }}
                className="flex cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm text-danger hover:bg-danger-bg"
              >
                <LogoutIcon className="h-4 w-4" />
                Log out
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
