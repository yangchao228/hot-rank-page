import { describe, expect, test } from "vitest";
import { SwrCache } from "../src/services/cache.js";
import { HotService } from "../src/services/hot-service.js";

class MockUpstreamClient {
  public lastQuery: Record<string, string> | null = null;

  async fetchJson(_source: string, query: Record<string, string>) {
    this.lastQuery = query;
    return {
      code: 200,
      title: "Demo",
      type: "Hot",
      link: "https://example.com",
      data: [
        { id: 1, title: "B", url: "https://b.example.com", timestamp: "2026-02-15T09:00:00.000Z" },
        { title: "A", timestamp: "2026-02-15T10:00:00.000Z" },
      ],
    };
  }

  async fetchRss() {
    return "<rss></rss>";
  }

  async ping() {
    return { ok: true, latencyMs: 10 };
  }
}

describe("HotService", () => {
  test("only forwards allowed params", async () => {
    const upstream = new MockUpstreamClient();
    const service = new HotService({
      cache: new SwrCache({ ttlSeconds: 10, staleSeconds: 10, useRedis: false }),
      upstreamClient: upstream,
    });

    await service.getStandardFeed("github", new URLSearchParams("type=weekly&foo=bar&limit=5"));

    expect(upstream.lastQuery).toEqual({
      type: "weekly",
      limit: "5",
    });
  });

  test("normalizes missing fields and respects item limit", async () => {
    const service = new HotService({
      cache: new SwrCache({ ttlSeconds: 10, staleSeconds: 10, useRedis: false }),
      upstreamClient: new MockUpstreamClient(),
    });

    const response = await service.getStandardFeed("weibo", new URLSearchParams("limit=1"));

    expect(response.code).toBe(200);
    expect(response.data.items).toHaveLength(1);
    expect(response.data.items[0]?.id).toBe("1");
    expect(response.data.items[0]?.title).toBe("B");
  });

  test("aggregate deduplicates by url then title and sorts by timestamp", async () => {
    const service = new HotService({
      cache: new SwrCache({ ttlSeconds: 10, staleSeconds: 10, useRedis: false }),
      upstreamClient: new MockUpstreamClient(),
    });

    const response = await service.getAggregateFeed(
      new URLSearchParams("sources=weibo,zhihu&limit=10"),
    );

    expect(response.code).toBe(200);
    expect(response.data.items[0]?.title).toBe("A");
    expect(response.data.items.length).toBeGreaterThan(0);
  });
});
