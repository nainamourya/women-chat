"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Mascot } from "@/components/Mascot";
import { FloatingDoodles } from "@/components/FloatingDoodles";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        setError("Invalid email or password.");
        return;
      }

      router.push("/eligibility");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <motion.main
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="relative mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16"
    >
      <FloatingDoodles />
      <Mascot mood="wave" size="sm" className="mb-3 self-start" />
      <h1 className="mb-1 text-2xl font-semibold text-foreground">Welcome back</h1>
      <p className="mb-6 text-sm text-muted">Log in to continue to JinGirl.</p>

      <Card className="flex flex-col gap-5 p-6">
        <Button
          type="button"
          variant="secondary"
          onClick={() => signIn("google", { callbackUrl: "/eligibility" })}
          className="w-full"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path
              fill="#4285F4"
              d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.42 3.58v3h3.92c2.29-2.11 3.52-5.21 3.52-8.82z"
            />
            <path
              fill="#34A853"
              d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.92-3c-1.08.73-2.47 1.16-4.01 1.16-3.08 0-5.7-2.08-6.64-4.88H1.31v3.09C3.28 21.3 7.31 24 12 24z"
            />
            <path
              fill="#FBBC05"
              d="M5.36 14.37c-.24-.73-.38-1.5-.38-2.37s.14-1.64.38-2.37V6.54H1.31A11.96 11.96 0 0 0 0 12c0 1.94.47 3.77 1.31 5.46l4.05-3.09z"
            />
            <path
              fill="#EA4335"
              d="M12 4.75c1.76 0 3.34.61 4.58 1.79l3.44-3.44C17.94 1.19 15.24 0 12 0 7.31 0 3.28 2.7 1.31 6.54l4.05 3.09c.94-2.8 3.56-4.88 6.64-4.88z"
            />
          </svg>
          Continue with Google
        </Button>

        <div className="flex items-center gap-3 text-xs text-muted">
          <span className="h-px flex-1 bg-border" />
          or
          <span className="h-px flex-1 bg-border" />
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Input
            label="Email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <Input
            label="Password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          {error && <Alert variant="danger">{error}</Alert>}

          <Button type="submit" disabled={submitting} className="mt-1 w-full">
            {submitting ? "Logging in…" : "Log in"}
          </Button>
        </form>
      </Card>

      <p className="mt-4 text-center text-sm text-muted">
        No account?{" "}
        <Link href="/signup" className="font-medium text-brand hover:text-brand-hover">
          Sign up
        </Link>
      </p>
    </motion.main>
  );
}
