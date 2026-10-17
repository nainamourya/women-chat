import Link from "next/link";
import { Logo } from "./Logo";

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-surface">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-12 sm:px-8 md:flex-row md:justify-between">
        <div className="flex flex-col gap-3">
          <Logo />
          <p className="max-w-xs text-sm text-muted">
            A women-only space for real conversation — reviewed by a person, never an algorithm.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          <div className="flex flex-col gap-2.5">
            <span className="text-sm font-semibold text-foreground">Product</span>
            <FooterLink href="/#how-it-works">How it works</FooterLink>
            <FooterLink href="/#safety">Safety &amp; privacy</FooterLink>
            <FooterLink href="/signup">Create an account</FooterLink>
          </div>

          <div className="flex flex-col gap-2.5">
            <span className="text-sm font-semibold text-foreground">Account</span>
            <FooterLink href="/login">Log in</FooterLink>
            <FooterLink href="/eligibility">Eligibility status</FooterLink>
          </div>

          <div className="flex flex-col gap-2.5">
            <span className="text-sm font-semibold text-foreground">Support</span>
            <FooterLink href="mailto:support@giigirl.com">Contact us</FooterLink>
          </div>

          <div className="flex flex-col gap-2.5">
            <span className="text-sm font-semibold text-foreground">Legal</span>
            <FooterLink href="/terms">Terms of Service</FooterLink>
            <FooterLink href="/privacy">Privacy Policy</FooterLink>
            <FooterLink href="/guidelines">Community Guidelines</FooterLink>
          </div>
        </div>
      </div>

      <div className="border-t border-border">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-6 py-5 text-xs text-muted sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <p>© {new Date().getFullYear()} GiiGirl. All rights reserved.</p>
          <p>Built for adults 18+. Not a dating app.</p>
        </div>
      </div>
    </footer>
  );
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-sm text-muted transition-colors hover:text-brand">
      {children}
    </Link>
  );
}
