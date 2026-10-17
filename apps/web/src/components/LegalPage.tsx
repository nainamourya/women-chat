import type { ReactNode } from "react";
import Link from "next/link";

// Shared layout for the Terms, Privacy and Community Guidelines pages.
//
// These are DRAFTS written from what the app actually does (see the data
// flows in apps/server). They have not been reviewed by a lawyer. Anything
// that is a legal or business decision rather than a fact about the code is
// wrapped in <Confirm> so it renders highlighted and can't be missed. Before
// launch: resolve every <Confirm>, then flip LEGAL_DRAFT to false to remove
// the draft banner.
export const LEGAL_DRAFT = true;

const LEGAL_LINKS = [
  { href: "/terms", label: "Terms of Service" },
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/guidelines", label: "Community Guidelines" },
] as const;

export function LegalPage({
  title,
  intro,
  current,
  children,
}: {
  title: string;
  intro: string;
  current: (typeof LEGAL_LINKS)[number]["href"];
  children: ReactNode;
}) {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-12 sm:px-8 md:py-16">
      {LEGAL_DRAFT && (
        <div
          role="note"
          className="mb-8 rounded-lg border border-warning/30 bg-warning-bg px-4 py-3 text-sm text-warning"
        >
          <strong className="font-semibold">Draft — not yet reviewed by a lawyer.</strong> Highlighted
          &ldquo;To confirm&rdquo; items are decisions the GiiGirl team still needs to make.
        </div>
      )}

      <nav aria-label="Legal pages" className="mb-6 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {LEGAL_LINKS.map((l) =>
          l.href === current ? (
            <span key={l.href} aria-current="page" className="font-semibold text-foreground">
              {l.label}
            </span>
          ) : (
            <Link key={l.href} href={l.href} className="text-muted transition-colors hover:text-brand">
              {l.label}
            </Link>
          ),
        )}
      </nav>

      <h1 className="font-display text-3xl font-bold text-foreground">{title}</h1>
      <p className="mt-3 text-base leading-relaxed text-muted">{intro}</p>
      <p className="mt-2 text-xs text-muted">
        Last updated: <Confirm>date of publication</Confirm>
      </p>

      <div className="mt-10 flex flex-col gap-9">{children}</div>
    </main>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 text-sm leading-relaxed text-foreground">
      <h2 className="font-display text-xl font-bold">{title}</h2>
      {children}
    </section>
  );
}

export function LegalList({ children }: { children: ReactNode }) {
  return <ul className="list-disc space-y-1.5 pl-5">{children}</ul>;
}

// Marks a legal/business detail the team must confirm. Visible on purpose.
export function Confirm({ children }: { children: ReactNode }) {
  return (
    <mark className="rounded bg-warning-bg px-1 font-medium text-warning">[To confirm: {children}]</mark>
  );
}
