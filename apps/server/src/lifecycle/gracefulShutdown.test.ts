import { afterEach, describe, expect, it, vi } from "vitest";
import { createGracefulShutdown } from "./gracefulShutdown.js";

const noop = () => {};

afterEach(() => {
  vi.useRealTimers();
});

describe("createGracefulShutdown", () => {
  it("closes the socket server, redis, and db, then exits 0", async () => {
    const closeSocketServer = vi.fn().mockResolvedValue(undefined);
    const closeRedis = vi.fn().mockResolvedValue(undefined);
    const closeDb = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn();
    const shutdown = createGracefulShutdown({
      closeSocketServer,
      closeRedis,
      closeDb,
      exit,
      log: noop,
      logError: noop,
    });

    await shutdown("SIGTERM");

    expect(closeSocketServer).toHaveBeenCalledOnce();
    expect(closeRedis).toHaveBeenCalledOnce();
    expect(closeDb).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("only runs once even if triggered twice concurrently", async () => {
    const closeSocketServer = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn();
    const shutdown = createGracefulShutdown({
      closeSocketServer,
      closeRedis: vi.fn().mockResolvedValue(undefined),
      closeDb: vi.fn().mockResolvedValue(undefined),
      exit,
      log: noop,
      logError: noop,
    });

    await Promise.all([shutdown("SIGTERM"), shutdown("SIGINT")]);

    expect(closeSocketServer).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledOnce();
  });

  it("still exits 0 if closing an individual dependency rejects", async () => {
    const exit = vi.fn();
    const shutdown = createGracefulShutdown({
      closeSocketServer: vi.fn().mockResolvedValue(undefined),
      closeRedis: vi.fn().mockRejectedValue(new Error("boom")),
      closeDb: vi.fn().mockResolvedValue(undefined),
      exit,
      log: noop,
      logError: noop,
    });

    await shutdown("SIGTERM");

    expect(exit).toHaveBeenCalledWith(0);
  });

  it("forces exit(1) and closes all connections if shutdown exceeds the timeout", async () => {
    vi.useFakeTimers();
    const closeAllConnections = vi.fn();
    const exit = vi.fn();
    const shutdown = createGracefulShutdown({
      closeSocketServer: () => new Promise(() => {}), // never resolves
      closeRedis: vi.fn().mockResolvedValue(undefined),
      closeDb: vi.fn().mockResolvedValue(undefined),
      closeAllConnections,
      exit,
      timeoutMs: 50,
      log: noop,
      logError: noop,
    });

    void shutdown("SIGTERM");
    await vi.advanceTimersByTimeAsync(60);

    expect(closeAllConnections).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("does not force-exit if shutdown completes before the timeout", async () => {
    vi.useFakeTimers();
    const closeAllConnections = vi.fn();
    const exit = vi.fn();
    const shutdown = createGracefulShutdown({
      closeSocketServer: vi.fn().mockResolvedValue(undefined),
      closeRedis: vi.fn().mockResolvedValue(undefined),
      closeDb: vi.fn().mockResolvedValue(undefined),
      closeAllConnections,
      exit,
      timeoutMs: 10_000,
      log: noop,
      logError: noop,
    });

    await shutdown("SIGTERM");
    await vi.advanceTimersByTimeAsync(10_001);

    expect(closeAllConnections).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(0);
  });
});
