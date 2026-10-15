// Extracted from index.ts (rather than wired directly to process.on) so the
// shutdown sequence itself is unit-testable: real signal handling just calls
// the function this factory returns, with real dependencies; tests pass
// fakes/spies instead, so no test run ever calls process.exit or touches a
// real socket/Redis/Postgres connection.
export type GracefulShutdownDeps = {
  closeSocketServer: () => Promise<void>;
  closeRedis: () => Promise<void>;
  closeDb: () => Promise<void>;
  closeIdleConnections?: () => void;
  closeAllConnections?: () => void;
  timeoutMs?: number;
  exit?: (code: number) => void;
  log?: (message: string) => void;
  logError?: (message: string, err: unknown) => void;
};

export function createGracefulShutdown(deps: GracefulShutdownDeps) {
  const {
    closeSocketServer,
    closeRedis,
    closeDb,
    closeIdleConnections,
    closeAllConnections,
    timeoutMs = 10_000,
    exit = process.exit,
    log = console.log,
    logError = console.error,
  } = deps;

  let shuttingDown = false;

  return async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`${signal} received — starting graceful shutdown`);

    let timedOut = false;
    const forceTimer = setTimeout(() => {
      timedOut = true;
      logError(`Graceful shutdown did not complete within ${timeoutMs}ms — forcing close.`, undefined);
      closeAllConnections?.();
      exit(1);
    }, timeoutMs);
    forceTimer.unref?.();

    try {
      // Nudge idle keep-alive HTTP connections closed immediately so the
      // drain below isn't stuck waiting on clients that already finished.
      closeIdleConnections?.();
      await closeSocketServer();
      await Promise.allSettled([closeRedis(), closeDb()]);
    } catch (err) {
      logError("Error during graceful shutdown:", err);
    } finally {
      clearTimeout(forceTimer);
      if (!timedOut) exit(0);
    }
  };
}
