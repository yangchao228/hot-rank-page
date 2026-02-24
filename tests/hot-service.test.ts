import { describe, expect, test } from "vitest";
import { SwrCache } from "../src/services/cache.js";
import { HotService } from "../src/services/hot-service.js";

function createServiceWithLocalMock(payloadBySource: Record<string, Record<string, unknown>>) {
  const service = new HotService({
    cache: new SwrCache({ ttlSeconds: 10, staleSeconds: 10, useRedis: false }),
  });
  (service as unknown as { fetchLocalFallback: (source: string) => Promise<Record<string, unknown>> })
    .fetchLocalFallback = async (source: string) => {
    const payload = payloadBySource[source];
    if (!payload) {
      throw new Error(`mock source not found: ${source}`);
    }
    return payload;
  };
  return service;
}

describe("HotService", () => {
  test("rejects unsupported sources after switching to local-only mode", async () => {
    const service = createServiceWithLocalMock({});
    await expect(service.getStandardFeed("github", new URLSearchParams("limit=5"))).rejects.toMatchObject({
      status: 404,
    });
  });

  test("normalizes missing fields and respects item limit", async () => {
    const service = createServiceWithLocalMock({
      weibo: {
        code: 200,
        title: "Demo",
        type: "Hot",
        link: "https://example.com",
        data: [
          { id: 1, title: "B", url: "https://b.example.com", timestamp: "2026-02-15T09:00:00.000Z" },
          { title: "A", timestamp: "2026-02-15T10:00:00.000Z" },
        ],
      },
    });

    const response = await service.getStandardFeed("weibo", new URLSearchParams("limit=1"));

    expect(response.code).toBe(200);
    expect(response.data.items).toHaveLength(1);
    expect(response.data.items[0]?.id).toBe("1");
    expect(response.data.items[0]?.title).toBe("B");
  });

  test("aggregate deduplicates by url then title and sorts by timestamp", async () => {
    const service = createServiceWithLocalMock({
      weibo: {
        title: "微博",
        data: [
          { id: "w1", title: "同链接", url: "https://same.example.com", timestamp: "2026-02-15T08:00:00Z" },
          { id: "w2", title: "仅标题去重", timestamp: "2026-02-15T07:00:00Z" },
        ],
      },
      zhihu: {
        title: "知乎",
        data: [
          { id: "z1", title: "同链接", url: "https://same.example.com", timestamp: "2026-02-15T11:00:00Z" },
          { id: "z2", title: "仅标题去重", timestamp: "2026-02-15T09:30:00Z" },
          { id: "z3", title: "新条目", timestamp: "2026-02-15T10:30:00Z" },
        ],
      },
    });

    const response = await service.getAggregateFeed(
      new URLSearchParams("sources=weibo,zhihu&limit=10"),
    );

    expect(response.code).toBe(200);
    expect(response.data.items[0]?.title).toBe("新条目");
    expect(response.data.items[1]?.title).toBe("同链接");
    expect(response.data.items[2]?.title).toBe("仅标题去重");
    expect(response.data.items.some((item) => item.title === "仅标题去重")).toBe(true);
    expect(response.data.items.length).toBe(3);
  });
});
