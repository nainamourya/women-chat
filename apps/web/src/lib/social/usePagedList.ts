"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, type Page } from "./api";

type Status = "loading" | "ready" | "error";

const asApiError = (err: unknown) => (err instanceof ApiError ? err : new ApiError("Something went wrong.", 0));

// Cursor-paginated list with loading, "load more", error and reload handling.
// `key` identifies what is being listed: when it changes the list starts over,
// and a response for a previous key is ignored if it arrives late.
export function usePagedList<T>(load: (cursor: string | null) => Promise<Page<T>>, key: string) {
  const [items, setItems] = useState<T[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<ApiError | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const page = await load(null);
        if (cancelled) return;
        setItems(page.items);
        setNextCursor(page.nextCursor);
        setError(null);
        setStatus("ready");
      } catch (err) {
        if (cancelled) return;
        setError(asApiError(err));
        setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
    // `load` is a fresh closure every render; `key` identifies the list and
    // `attempt` re-runs it on demand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);

  const reload = useCallback(() => {
    setStatus("loading");
    setAttempt((n) => n + 1);
  }, []);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await load(nextCursor);
      setItems((prev) => [...prev, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (err) {
      setError(asApiError(err));
    } finally {
      setLoadingMore(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextCursor, loadingMore, key]);

  return { items, setItems, status, error, hasMore: nextCursor !== null, loadMore, loadingMore, reload };
}
