"use client";

import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import { useSession } from "next-auth/react";
import { FloatingDoodles } from "@/components/FloatingDoodles";
import girlArt from "../../public/char-girl.png";
import bunnyArt from "../../public/char-bunny.png";
import catArt from "../../public/char-cat.png";
import cloudArt from "../../public/char-cloud.png";
import ghostArt from "../../public/char-ghost.png";

function ShieldHeartIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
      <path
        d="M12 3l7 3v5c0 4.5-3 8-7 9-4-1-7-4.5-7-9V6l7-3z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M12 9.8c.6-.9 1.6-1.3 2.5-.9 1 .4 1.4 1.6.9 2.6-.5 1-2 2.3-3.4 3.2-1.4-.9-2.9-2.2-3.4-3.2-.5-1-.1-2.2.9-2.6.9-.4 1.9 0 2.5.9z"
        fill="currentColor"
      />
    </svg>
  );
}

function PersonCheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
      <circle cx="10" cy="8" r="3.4" stroke="currentColor" strokeWidth="1.6" />
      <path d="M4 20c0-3.3 2.7-5.5 6-5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M15.5 16.2l1.8 1.8 3.2-3.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
      <rect x="5" y="10.5" width="14" height="9.5" rx="2.2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="12" cy="15" r="1.4" fill="currentColor" />
    </svg>
  );
}

function ChatHeartIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
      <path
        d="M4 11c0-4 3.6-7 8-7s8 3 8 7-3.6 7-8 7c-1 0-2-.15-2.9-.45L5 19.5l1.2-3.6C4.8 14.6 4 12.9 4 11z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const trustPoints = [
  {
    icon: PersonCheckIcon,
    title: "People, not bots",
    body: "Every new member submits a short intro video. A real person reviews it before you can chat with anyone.",
  },
  {
    icon: ShieldHeartIcon,
    title: "Women only, always",
    body: "No men, no mixed matching, no exceptions. GiiGirl exists for one kind of conversation.",
  },
  {
    icon: LockIcon,
    title: "Private by default",
    body: "Your profile is never public. Your verification video is deleted the moment it's reviewed.",
  },
  {
    icon: ChatHeartIcon,
    title: "No swiping, no pressure",
    body: "You're paired one-on-one for a real conversation — not a feed to scroll or a grid to browse.",
  },
];

const steps = [
  {
    title: "Create your account",
    body: "Sign up with email or Google. Takes under a minute.",
  },
  {
    title: "Quick eligibility check",
    body: "Record a short intro video. A real person reviews it — usually within a day.",
  },
  {
    title: "Get matched",
    body: "Once you're verified, we pair you with another verified woman who's free to talk.",
  },
  {
    title: "Start the conversation",
    body: "Chat privately, one-on-one. End it anytime, no explanation needed.",
  },
];

export default function Home() {
  const { data: session, status } = useSession();

  return (
    <main className="flex flex-1 flex-col">
      {/* Hero */}
      <section className="relative overflow-hidden">
        <FloatingDoodles />
        <div className="mx-auto grid w-full max-w-5xl items-center gap-10 px-6 py-14 sm:px-8 sm:py-20 md:grid-cols-2 md:gap-6 md:py-28">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, ease: "easeOut" }}
            className="flex flex-col items-start gap-5 text-left"
          >
            <h1 className="font-display text-[2.1rem] leading-[1.1] font-extrabold tracking-tight text-foreground sm:text-5xl">
              A women-only space for real conversation
            </h1>
            <p className="max-w-md text-base leading-relaxed text-muted">
              GiiGirl pairs you with another adult woman for a private, one-on-one chat —
              no feeds, no swiping, no men. Every member is reviewed by a real person
              before they can talk to anyone.
            </p>

            {status === "authenticated" && session ? (
              <Link
                href="/match"
                className="rounded-full bg-brand px-6 py-3 text-sm font-semibold text-brand-foreground shadow-md transition-transform hover:-translate-y-0.5 hover:bg-brand-hover"
              >
                Find someone to talk to
              </Link>
            ) : status === "unauthenticated" ? (
              <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
                <Link
                  href="/signup"
                  className="rounded-full bg-brand px-6 py-3 text-center text-sm font-semibold text-brand-foreground shadow-md transition-transform hover:-translate-y-0.5 hover:bg-brand-hover"
                >
                  Create your account
                </Link>
                <Link
                  href="/login"
                  className="rounded-full border border-border px-6 py-3 text-center text-sm font-semibold text-foreground transition-transform hover:-translate-y-0.5 hover:bg-surface-hover"
                >
                  Log in
                </Link>
              </div>
            ) : (
              <div className="h-[46px]" aria-hidden="true" />
            )}

            <p className="text-xs text-muted">For adults 18+. Free to join.</p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, delay: 0.1, ease: "easeOut" }}
            className="relative flex h-[22rem] w-full items-center justify-center sm:h-[26rem]"
          >
            <div className="absolute top-1/2 left-1/2 -z-10 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full bg-lavender/70 blur-2xl dark:bg-lavender/25" />
            <Image
              src={girlArt}
              alt="Illustration of a woman smiling warmly"
              priority
              className="absolute top-0 left-2 w-[56%] -rotate-3 drop-shadow-xl sm:left-6"
            />
            <Image
              src={bunnyArt}
              alt="Illustration of a cheerful bunny"
              priority
              className="absolute right-0 bottom-2 w-[46%] rotate-6 drop-shadow-xl sm:right-4"
            />
          </motion.div>
        </div>
      </section>

      {/* Trust strip */}
      <section id="safety" className="border-t border-border bg-surface">
        <div className="mx-auto grid w-full max-w-5xl gap-10 px-6 py-14 sm:px-8 md:grid-cols-[0.8fr_1.2fr] md:gap-16 md:py-20">
          <div className="flex flex-col gap-4">
            <h2 className="font-display text-2xl font-bold text-foreground sm:text-3xl">
              Built to feel safe, not just say it
            </h2>
            <p className="max-w-xs text-sm leading-relaxed text-muted">
              Most apps ask you to trust a policy. GiiGirl is built so there&apos;s nothing
              risky to trust in the first place.
            </p>
          </div>

          <dl className="flex flex-col divide-y divide-border">
            {trustPoints.map(({ icon: Icon, title, body }) => (
              <div key={title} className="flex items-start gap-4 py-5 first:pt-0 last:pb-0">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-lavender text-lavender-ink">
                  <Icon />
                </span>
                <div>
                  <dt className="text-sm font-semibold text-foreground">{title}</dt>
                  <dd className="mt-0.5 text-sm leading-relaxed text-muted">{body}</dd>
                </div>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="border-t border-border">
        <div className="mx-auto grid w-full max-w-5xl gap-10 px-6 py-14 sm:px-8 md:grid-cols-[1fr_1.1fr] md:gap-12 md:py-20">
          <div className="flex flex-col gap-6">
            <h2 className="font-display text-2xl font-bold text-foreground sm:text-3xl">
              How GiiGirl works
            </h2>
            <ol className="flex flex-col gap-6">
              {steps.map((step, i) => (
                <li key={step.title} className="flex gap-4">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-semibold text-brand-foreground">
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">{step.title}</h3>
                    <p className="text-sm leading-relaxed text-muted">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div className="relative flex h-72 items-center justify-center sm:h-80">
            <div className="absolute top-1/2 left-1/2 -z-10 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent-bg blur-2xl" />
            <Image
              src={catArt}
              alt="Illustration of a playful cat"
              className="absolute bottom-0 left-1/2 w-[48%] -translate-x-[62%] rotate-3 drop-shadow-xl"
            />
            <Image
              src={cloudArt}
              alt="Illustration of a smiling cloud"
              className="absolute top-2 left-1/2 w-[38%] translate-x-[10%] -rotate-6 drop-shadow-xl"
            />
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative overflow-hidden border-t border-border bg-surface">
        <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-2 px-6 py-16 text-center sm:px-8">
          <div className="relative mb-2 h-28 w-28">
            <div className="absolute top-1/2 left-1/2 -z-10 h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full bg-lavender/70 blur-2xl dark:bg-lavender/25" />
            <Image src={ghostArt} alt="Illustration of a friendly ghost" className="drop-shadow-xl" />
          </div>
          <h2 className="font-display max-w-md text-2xl font-bold text-foreground sm:text-3xl">
            Ready to talk to someone who gets it?
          </h2>
          {status !== "authenticated" && (
            <Link
              href="/signup"
              className="rounded-full bg-brand px-7 py-3.5 text-sm font-semibold text-brand-foreground shadow-md transition-transform hover:-translate-y-0.5 hover:bg-brand-hover"
            >
              Create your account
            </Link>
          )}
        </div>
      </section>
    </main>
  );
}
