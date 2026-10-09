"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Badge } from "@/components/ui/Badge";
import { Mascot } from "@/components/Mascot";
import { FloatingDoodles } from "@/components/FloatingDoodles";

export default function Home() {
  return (
    <main className="relative mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-6 px-6 py-16 text-center sm:py-24">
      <FloatingDoodles />
      <motion.div
        initial={{ opacity: 0, y: -10, scale: 0.85 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
      >
        <Mascot mood="wave" size="lg" caption="Hey!" />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.15, ease: "easeOut" }}
        className="flex flex-col items-center gap-5"
      >
        <Badge variant="warning">Prototype — not yet available to the public</Badge>

        <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
          A women-only space <span className="text-brand">for real conversation</span>
        </h1>

        <p className="max-w-xl text-base leading-relaxed text-muted">
          JinGirl is an early MVP for peer-to-peer conversation between adult women
          (18+) — not a dating app, not a content platform. Eligibility verification
          is currently a <strong className="text-foreground">prototype/test flow only</strong>,
          not a real identity or age check. Matching and chat features are still in
          development.
        </p>

        <div className="flex flex-col items-center gap-3 sm:flex-row">
          <Link
            href="/signup"
            className="rounded-full bg-brand px-5 py-2.5 text-sm font-medium text-brand-foreground shadow-md transition-transform hover:-translate-y-0.5 hover:bg-brand-hover"
          >
            Create an account
          </Link>
          <Link
            href="/login"
            className="rounded-full border border-border px-5 py-2.5 text-sm font-medium text-foreground transition-transform hover:-translate-y-0.5 hover:bg-surface-hover"
          >
            Log in
          </Link>
        </div>
      </motion.div>
    </main>
  );
}
