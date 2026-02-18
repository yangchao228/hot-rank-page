import { describe, expect, test, vi } from "vitest";
import { SwrCache } from "../src/services/cache.js";
import { HotService } from "../src/services/hot-service.js";

class ThrowingUpstreamClient {
  async fetchJson(): Promise<Record<string, unknown>> {
    throw new Error("upstream down");
  }

  async fetchRss(): Promise<string> {
    throw new Error("upstream down");
  }

  async ping() {
    return { ok: false, latencyMs: 0, message: "down" };
  }
}

describe("Zhihu fallback", () => {
  test("uses api.zhihu.com fallback for standard feed", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          data: [
            {
              target: {
                id: 123,
                title: "T1",
                url: "https://api.zhihu.com/questions/123",
                created: 1700000000,
                excerpt: "E1",
              },
              detail_text: "1.2 万热度",
              children: [{ thumbnail: "https://img.example.com/1.png" }],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const service = new HotService({
      cache: new SwrCache({ ttlSeconds: 60, staleSeconds: 60, useRedis: false }),
      upstreamClient: new ThrowingUpstreamClient(),
    });

    const response = await service.getStandardFeed("zhihu", new URLSearchParams("limit=10"));
    expect(response.code).toBe(200);
    expect(response.data.source).toBe("zhihu");
    expect(response.data.items[0]?.title).toBe("T1");
    expect(response.data.items[0]?.url).toContain("zhihu.com/question/123");

    vi.unstubAllGlobals();
  });
});

