"use client";

import { useState } from "react";
import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { AnimatePresence, motion } from "framer-motion";

function LogoMark() {
  return (
    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand/15">
      <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
        <path
          fill="#7c3aed"
          d="M12 21s-7.5-4.6-10-9.3C.5 7.9 2.6 4 6.4 4c2 0 3.6 1.1 4.6 2.6C12 5.1 13.6 4 15.6 4c3.8 0 5.9 3.9 4.4 7.7C19.5 16.4 12 21 12 21z"
        />
      </svg>
    </span>
  );
}

function HamburgerIcon({ open }: { open: boolean }) {
  const barClass = "absolute left-0 h-0.5 w-5 rounded-full bg-foreground";
  return (
    <span className="relative flex h-4 w-5 items-center justify-center">
      <motion.span
        className={barClass}
        animate={{ y: open ? 0 : -6, rotate: open ? 45 : 0 }}
        transition={{ duration: 0.25, ease: "easeInOut" }}
      />
      <motion.span
        className={barClass}
        animate={{ opacity: open ? 0 : 1 }}
        transition={{ duration: 0.15, ease: "easeInOut" }}
      />
      <motion.span
        className={barClass}
        animate={{ y: open ? 0 : 6, rotate: open ? -45 : 0 }}
        transition={{ duration: 0.25, ease: "easeInOut" }}
      />
    </span>
  );
}

export function SiteHeader() {
  const { status } = useSession();
  const [open, setOpen] = useState(false);

  const links =
    status === "authenticated" ? (
      <>
        <Link href="/profile" className="hover:text-brand" onClick={() => setOpen(false)}>
          Profile
        </Link>
        <Link href="/profile?tab=settings" className="hover:text-brand" onClick={() => setOpen(false)}>
          Settings
        </Link>
        <Link href="/eligibility" className="hover:text-brand" onClick={() => setOpen(false)}>
          Eligibility
        </Link>
        <Link href="/match" className="hover:text-brand" onClick={() => setOpen(false)}>
          Find someone
        </Link>
        <button
          onClick={() => {
            setOpen(false);
            signOut({ callbackUrl: "/" });
          }}
          className="cursor-pointer text-left text-muted hover:text-foreground"
        >
          Log out
        </button>
      </>
    ) : (
      <>
        <Link href="/login" className="hover:text-brand" onClick={() => setOpen(false)}>
          Log in
        </Link>
        <Link
          href="/signup"
          onClick={() => setOpen(false)}
          className="rounded-full bg-brand px-3.5 py-1.5 text-center text-brand-foreground shadow-sm hover:bg-brand-hover"
        >
          Sign up
        </Link>
      </>
    );

  return (
    <>
      {/* Rendered outside <header> because its backdrop-blur would otherwise
          turn it into the containing block for this fixed-position overlay,
          trapping it inside the header's own (thin) box. */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="mobile-nav-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="fixed inset-0 z-10 bg-foreground/20 transition-none sm:hidden"
            onClick={() => setOpen(false)}
          />
        )}
      </AnimatePresence>

      <header className="sticky top-0 z-20 border-b border-border bg-surface/80 backdrop-blur-md relative">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-x-4 px-5 py-3.5 sm:px-6">
          <Link href="/" className="flex items-center gap-2 font-semibold text-foreground">
            <LogoMark />
            Jin<span className="text-brand">Girl</span>
          </Link>

          <nav className="hidden items-center gap-x-5 text-sm text-foreground sm:flex">{links}</nav>

          <button
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface sm:hidden"
          >
            <HamburgerIcon open={open} />
          </button>
        </div>

        <AnimatePresence initial={false}>
          {open && (
            <motion.nav
              key="mobile-nav"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: "easeInOut" }}
              className="absolute left-0 right-0 top-full z-20 border-t border-border bg-surface shadow-md transition-none sm:hidden"
            >
              <div className="flex flex-col gap-3 px-5 py-4 text-sm text-foreground">{links}</div>
            </motion.nav>
          )}
        </AnimatePresence>
      </header>
    </>
  );
}
