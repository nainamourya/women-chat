"use client";

import Link from "next/link";
import Image from "next/image";
import { motion, MotionConfig, useReducedMotion } from "framer-motion";
import { useSession } from "next-auth/react";
import { FloatingDoodles } from "@/components/FloatingDoodles";
import { Badge } from "@/components/ui/Badge";
import girlArt from "../../public/char-girl.png";
import girlArtDark from "../../public/char-girl-dark.png";

// GiiGirl's one approved brand character image — the same asset is reused at
// different sizes/placements across the page rather than faking new poses (no
// image-generation tool is available to create real new poses). Never
// rotated, skewed, or stretched; only uniformly scaled.
//
// Dark mode uses a copy of the same artwork with only the sweater recolored
// white (public/char-girl-dark.png) — hair, skin, face and hearts are the
// original pixels. The swap keys off the app's own `.dark` class on <html>
// (set by ThemeProvider), not Tailwind's `dark:` variant, which here follows
// the OS setting and would ignore the in-app theme toggle.
function BrandCharacter({ className }: { className?: string }) {
  return (
    <>
      <Image src={girlArt} alt="GiiGirl" className={`${className ?? ""} [.dark_&]:hidden`} />
      <Image
        src={girlArtDark}
        alt="GiiGirl"
        aria-hidden="true"
        className={`${className ?? ""} hidden [.dark_&]:block`}
      />
    </>
  );
}

// A couple of small, slow-floating hearts for sections that don't have the
// full FloatingDoodles field — reuses the same ink-outlined heart shape so
// it reads as one illustration language, not a second decoration system.
function FloatingHeart({ className, delay = 0 }: { className?: string; delay?: number }) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.svg
      viewBox="0 0 24 24"
      className={className}
      initial={{ opacity: 0, y: 6 }}
      animate={reduceMotion ? { opacity: 0.9, y: 0 } : { opacity: 0.9, y: [6, -6, 6] }}
      transition={
        reduceMotion
          ? { duration: 0.5, delay }
          : { duration: 3.4, repeat: Infinity, ease: "easeInOut", delay }
      }
      aria-hidden="true"
    >
      <path
        d="M12 20 C4 14 2 9.5 5.2 6.8 C7.6 4.8 10.6 5.6 12 8 C13.4 5.6 16.4 4.8 18.8 6.8 C22 9.5 20 14 12 20 Z"
        fill="#f472b6"
        stroke="#3a2a52"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </motion.svg>
  );
}

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

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

export default function Home() {
  const { data: session, status } = useSession();
  const authed = status === "authenticated" && session;

  const primaryCta =
    status === "loading" ? null : authed ? (
      <Link
        href="/match"
        className="rounded-full bg-accent px-6 py-3 text-center text-sm font-semibold text-accent-foreground shadow-md transition-transform hover:-translate-y-0.5 hover:bg-accent-hover"
      >
        Find someone to talk to
      </Link>
    ) : (
      <Link
        href="/signup"
        className="rounded-full bg-accent px-6 py-3 text-center text-sm font-semibold text-accent-foreground shadow-md transition-transform hover:-translate-y-0.5 hover:bg-accent-hover"
      >
        Find someone to talk to
      </Link>
    );

  return (
    <MotionConfig reducedMotion="user">
      <main className="flex flex-1 flex-col">
        {/* Hero */}
        <section className="relative overflow-hidden bg-background">
          <FloatingDoodles />
          <div className="mx-auto grid w-full max-w-5xl items-center gap-8 px-6 py-10 sm:px-8 sm:py-20 md:grid-cols-2 md:gap-6 md:py-24">
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, ease: "easeOut" }}
              className="order-last flex flex-col items-start gap-5 text-left md:order-first"
            >
              <h1 className="font-display text-[2.1rem] leading-[1.1] font-extrabold tracking-tight text-foreground sm:text-5xl">
                A little more understood.
                <br className="hidden sm:block" /> A little less alone.
              </h1>
              <p className="max-w-md text-base leading-relaxed text-muted">
                Meet another adult woman for a genuine, one-to-one conversation. No swiping, no
                public feed — just a welcoming space to talk.
              </p>

              <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
                {primaryCta ?? <div className="h-[46px] w-44" aria-hidden="true" />}
                <a
                  href="#how-it-works"
                  className="rounded-full border border-border px-6 py-3 text-center text-sm font-semibold text-foreground transition-transform hover:-translate-y-0.5 hover:bg-surface-hover"
                >
                  See how it works
                </a>
              </div>

              <p className="text-xs text-muted">
                For adults 18+ · Human-reviewed eligibility · Private conversations
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.6, delay: 0.1, ease: "easeOut" }}
              className="relative order-first flex h-60 w-full items-center justify-center md:order-last md:h-[26rem]"
            >
              <div className="absolute top-1/2 left-1/2 -z-10 h-44 w-44 -translate-x-1/2 -translate-y-1/2 rounded-full bg-lavender/70 blur-xl dark:bg-lavender/25 md:h-72 md:w-72 md:blur-2xl" />
              <div className="absolute top-2 right-[12%] z-10 rounded-2xl rounded-br-sm border border-brand/20 bg-surface px-3 py-1.5 text-xs font-medium text-foreground shadow-md md:top-0 md:right-[6%] md:px-3.5 md:py-2 md:text-sm">
                Hey, welcome! 👋
              </div>
              <FloatingHeart className="absolute top-[18%] right-[6%] h-4 w-4 md:top-[8%] md:right-[18%] md:h-5 md:w-5" delay={0.3} />
              <FloatingHeart className="absolute bottom-[10%] left-[10%] h-4 w-4 md:bottom-[14%] md:left-[20%]" delay={1.1} />
              <BrandCharacter className="w-[62%] max-w-[220px] drop-shadow-xl md:w-[72%] md:max-w-sm" />
            </motion.div>
          </div>
        </section>

        {/* Trust & safety */}
        <section id="safety" className="border-t border-border bg-surface">
          <div className="mx-auto grid w-full max-w-5xl gap-10 px-6 py-14 sm:px-8 md:grid-cols-[0.8fr_1.2fr] md:gap-16 md:py-20">
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: "-80px" }}
              variants={fadeUp}
              transition={{ duration: 0.5 }}
              className="flex flex-col gap-4"
            >
              <BrandCharacter className="w-20" />
              <h2 className="font-display text-2xl font-bold text-foreground sm:text-3xl">
                Built to feel safe, not just say it
              </h2>
              <p className="max-w-xs text-sm leading-relaxed text-muted">
                Most apps ask you to trust a policy. GiiGirl is built so there&apos;s nothing
                risky to trust in the first place.
              </p>
            </motion.div>

            <motion.dl
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: "-80px" }}
              variants={fadeUp}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="flex flex-col divide-y divide-border"
            >
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
            </motion.dl>
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="border-t border-border bg-background">
          <div className="mx-auto w-full max-w-2xl px-6 py-14 sm:px-8 md:py-20">
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: "-80px" }}
              variants={fadeUp}
              transition={{ duration: 0.5 }}
              className="flex flex-col gap-6"
            >
              <h2 className="font-display text-center text-2xl font-bold text-foreground sm:text-3xl">
                How GiiGirl works
              </h2>
              <ol className="relative flex flex-col gap-6">
                <div aria-hidden="true" className="absolute top-2 bottom-2 left-4 w-px bg-border" />
                {steps.map((step, i) => (
                  <li key={step.title} className="relative flex gap-4">
                    <span className="z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-semibold text-brand-foreground">
                      {i + 1}
                    </span>
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">{step.title}</h3>
                      <p className="text-sm leading-relaxed text-muted">{step.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </motion.div>
          </div>
        </section>

        {/* Product preview — illustrative only, never live data */}
        <section className="border-t border-border bg-surface">
          <div className="mx-auto w-full max-w-5xl px-6 py-14 sm:px-8 md:py-20">
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: "-80px" }}
              variants={fadeUp}
              transition={{ duration: 0.5 }}
              className="mb-8 flex flex-col gap-2 text-center"
            >
              <h2 className="font-display text-2xl font-bold text-foreground sm:text-3xl">
                A peek inside
              </h2>
              <p className="mx-auto max-w-md text-sm text-muted">
                An illustrative look at the actual screens — not a live conversation or a real
                member.
              </p>
            </motion.div>

            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: "-80px" }}
              variants={fadeUp}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="mx-auto grid max-w-3xl gap-6 sm:grid-cols-2"
            >
              <div className="flex flex-col gap-3 rounded-2xl border border-border bg-background p-5">
                <span className="text-xs font-semibold text-muted">Eligibility status</span>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-foreground">Eligibility verification</span>
                  <Badge variant="success">Verified</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-foreground">Profile</span>
                  <Badge variant="success">Complete</Badge>
                </div>
              </div>

              <div className="flex flex-col gap-2.5 rounded-2xl border border-border bg-background p-5">
                <span className="text-xs font-semibold text-muted">Private chat</span>
                <div className="flex justify-start">
                  <div className="max-w-[80%] rounded-2xl bg-surface-hover px-3.5 py-2 text-sm text-foreground">
                    Hi! Thanks for matching with me 😊
                  </div>
                </div>
                <div className="flex justify-end">
                  <div className="max-w-[80%] rounded-2xl bg-brand px-3.5 py-2 text-sm text-brand-foreground">
                    Hey! Nice to meet you too
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="relative overflow-hidden border-t border-border bg-surface">
          <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-2 px-6 py-16 text-center sm:px-8">
            <div className="relative mb-2 h-32 w-32">
              <div className="absolute top-1/2 left-1/2 -z-10 h-44 w-44 -translate-x-1/2 -translate-y-1/2 rounded-full bg-lavender/70 blur-2xl dark:bg-lavender/25" />
              <FloatingHeart className="absolute -top-2 -right-1 h-5 w-5" delay={0.2} />
              <FloatingHeart className="absolute bottom-0 -left-3 h-4 w-4" delay={0.9} />
              <BrandCharacter className="h-full w-full object-contain drop-shadow-xl" />
            </div>
            <h2 className="font-display max-w-md text-2xl font-bold text-foreground sm:text-3xl">
              Your next good conversation starts here.
            </h2>
            <p className="max-w-sm text-sm text-muted">
              Take the first step toward a space designed for women to connect, share, and talk.
            </p>
            {primaryCta && <div className="mt-2">{primaryCta}</div>}
            <p className="mt-1 text-xs text-muted">
              For adults 18+. Every new member goes through a quick, human-reviewed eligibility
              check.
            </p>
          </div>
        </section>
      </main>
    </MotionConfig>
  );
}
