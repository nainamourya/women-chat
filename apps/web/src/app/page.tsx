import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-6 px-6 py-24 text-center">
      <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
        Prototype — not yet available to the public
      </span>
      <h1 className="text-3xl font-semibold sm:text-4xl">
        A women-only space for casual conversation
      </h1>
      <p className="max-w-xl text-zinc-600 dark:text-zinc-400">
        women-chat is an early MVP for peer-to-peer conversation between adult
        women (18+) — not a dating app, not a content platform. Eligibility
        verification is currently a{" "}
        <strong>prototype/test flow only</strong>, not a real identity or age
        check. Matching and chat features are still in development.
      </p>
      <div className="flex gap-3">
        <Link
          href="/signup"
          className="rounded-md bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white dark:bg-white dark:text-zinc-900"
        >
          Create an account
        </Link>
        <Link
          href="/login"
          className="rounded-md border border-zinc-300 px-5 py-2.5 text-sm font-medium dark:border-zinc-700"
        >
          Log in
        </Link>
      </div>
    </main>
  );
}
