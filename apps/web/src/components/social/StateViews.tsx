import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";

// Page container used by every social screen.
export function SocialPage({ title, actions, children }: { title?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 px-4 py-6">
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3">
          {title && <h1 className="font-display text-2xl font-bold text-foreground">{title}</h1>}
          {actions}
        </div>
      )}
      {children}
    </main>
  );
}

export function LoadingRows({ count = 3, label = "Loading" }: { count?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-3">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex animate-pulse items-center gap-3 rounded-lg border border-border bg-surface p-4">
          <div className="h-10 w-10 rounded-full bg-surface-hover" />
          <div className="flex flex-1 flex-col gap-2">
            <div className="h-3 w-1/3 rounded bg-surface-hover" />
            <div className="h-3 w-2/3 rounded bg-surface-hover" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: { href: string; label: string } }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-surface px-6 py-10 text-center">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      {body && <p className="max-w-sm text-sm text-muted">{body}</p>}
      {action && (
        <Link href={action.href} className="mt-2 rounded-md bg-brand px-4 py-2.5 text-sm font-medium text-brand-foreground shadow-md hover:bg-brand-hover">
          {action.label}
        </Link>
      )}
    </div>
  );
}

export function LoadMore({ hasMore, loading, onClick }: { hasMore: boolean; loading: boolean; onClick: () => void }) {
  if (!hasMore) return null;
  return (
    <div className="flex justify-center">
      <Button type="button" variant="outline" size="sm" loading={loading} onClick={onClick}>
        {loading ? "Loading…" : "Load more"}
      </Button>
    </div>
  );
}
