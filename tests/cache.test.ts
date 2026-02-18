import { describe, expect, test } from "vitest";
import { SwrCache } from "../src/services/cache.js";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("SwrCache", () => {
  test("transitions fresh -> stale -> miss", async () => {
    const cache = new SwrCache({ ttlSeconds: 1, staleSeconds: 1, useRedis: false });
    await cache.set("k", { value: 1 });

    const fresh = await cache.get<{ value: number }>("k");
    expect(fresh.state).toBe("fresh");

    await wait(1100);
    const stale = await cache.get<{ value: number }>("k");
    expect(stale.state).toBe("stale");

    await wait(1100);
    const miss = await cache.get("k");
    expect(miss.state).toBe("miss");
  });

  test("deduplicates background refresh by key", async () => {
    const cache = new SwrCache({ ttlSeconds: 1, staleSeconds: 1, useRedis: false });
    let calls = 0;

    await Promise.all([
      cache.scheduleRefresh("same", async () => {
        calls += 1;
        await wait(20);
      }),
      cache.scheduleRefresh("same", async () => {
        calls += 1;
        await wait(20);
      }),
    ]);

    expect(calls).toBe(1);
  });
});
