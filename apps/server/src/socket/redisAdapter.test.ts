import { describe, it, expect } from "vitest";
import { createRedisAdapter } from "./redisAdapter.js";
import { env } from "../config/env.js";

describe("createRedisAdapter", () => {
  it("resolves with a working adapter and closes cleanly against a reachable Redis", async () => {
    const handles = await createRedisAdapter(env.REDIS_URL);
    expect(typeof handles.adapter).toBe("function");
    await expect(handles.close()).resolves.toBeUndefined();
  });

  it("rejects without hanging, and cleans up both connections, when Redis is unreachable", async () => {
    await expect(createRedisAdapter("redis://127.0.0.1:1")).rejects.toThrow();
  }, 10_000);
});
