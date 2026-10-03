"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [ageConfirmed18, setAgeConfirmed18] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!ageConfirmed18) {
      setError("You must confirm you are 18 or older to continue.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, displayName, ageConfirmed18 }),
      });
      const data = await res.json();

      if (!res.ok) {
        const message =
          typeof data.error === "string"
            ? data.error
            : "Please check your details and try again.";
        setError(message);
        return;
      }

      const signInResult = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (signInResult?.error) {
        router.push("/login");
        return;
      }

      router.push("/eligibility");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      <h1 className="mb-1 text-2xl font-semibold">Create an account</h1>
      <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">
        This platform is for adult women (18+) only. Eligibility verification
        is currently a prototype/test flow, not a real identity check.
      </p>

      <button
        type="button"
        onClick={() => signIn("google", { callbackUrl: "/eligibility" })}
        className="mb-4 flex items-center justify-center gap-2 rounded-md border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-900 dark:border-zinc-700 dark:text-white"
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
      </button>

      <div className="mb-4 flex items-center gap-3 text-xs text-zinc-500">
        <span className="h-px flex-1 bg-zinc-300 dark:bg-zinc-700" />
        or
        <span className="h-px flex-1 bg-zinc-300 dark:bg-zinc-700" />
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Display name
          <input
            type="text"
            required
            minLength={2}
            maxLength={50}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Password
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          />
          <span className="text-xs text-zinc-500">At least 8 characters.</span>
        </label>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={ageConfirmed18}
            onChange={(e) => setAgeConfirmed18(e.target.checked)}
            className="mt-1"
          />
          <span>
            I confirm that I am 18 years of age or older and identify as a
            woman.
          </span>
        </label>

        {error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="mt-2 rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60 dark:bg-white dark:text-zinc-900"
        >
          {submitting ? "Creating account…" : "Create account"}
        </button>
      </form>
    </main>
  );
}
