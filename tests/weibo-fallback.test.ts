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

describe("Weibo fallback", () => {
  test("uses weibo local fallback for standard feed", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("weibo.com/ajax/side/hotSearch")) {
        return new Response(
          JSON.stringify({
            data: {
              realtime: [
                { word: "微博测试词", raw_hot: 1234567, onboard_time: "12:30" },
                { note: "第二条", num: "88.8万" },
              ],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("", { status: 404 });
    });

    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const service = new HotService({
      cache: new SwrCache({ ttlSeconds: 60, staleSeconds: 60, useRedis: false }),
      upstreamClient: new ThrowingUpstreamClient(),
    });

    const response = await service.getStandardFeed("weibo", new URLSearchParams("limit=10"));
    expect(response.code).toBe(200);
    expect(response.data.source).toBe("weibo");
    expect(response.data.items[0]?.title).toBe("微博测试词");
    expect(response.data.items[0]?.hot).toBe(1234567);

    vi.unstubAllGlobals();
  });
});
