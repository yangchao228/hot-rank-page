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

describe("Douyin/Kuaishou local fallback", () => {
  test("uses douyin local fallback for standard feed", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("iesdouyin.com")) {
        return new Response(
          JSON.stringify({
            active_time: "2026-02-18 22:21:07",
            word_list: [
              { word: "抖音测试词", hot_value: 123456, sentence_id: "111", event_time: 1771424594 },
            ],
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

    const response = await service.getStandardFeed("douyin", new URLSearchParams("limit=10"));
    expect(response.code).toBe(200);
    expect(response.data.source).toBe("douyin");
    expect(response.data.items[0]?.title).toBe("抖音测试词");

    vi.unstubAllGlobals();
  });

  test("uses kuaishou local fallback for standard feed", async () => {
    const html =
      '<html><script>window.__APOLLO_STATE__={"defaultClient":{"$ROOT_QUERY.visionHotRank({\\"page\\":\\"home\\"})":{"items":[{"id":"VisionHotRankItem:test"}]},"VisionHotRankItem:test":{"id":"hot-1","name":"快手测试词","hotValue":"947.6万","poster":"https%3A%2F%2Fexample.com%2Fcover.jpg","photoIds":{"json":["abc123"]}}}};(function(){})();</script></html>';

    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("kuaishou.com")) {
        return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
      }
      return new Response("", { status: 404 });
    });

    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const service = new HotService({
      cache: new SwrCache({ ttlSeconds: 60, staleSeconds: 60, useRedis: false }),
      upstreamClient: new ThrowingUpstreamClient(),
    });

    const response = await service.getStandardFeed("kuaishou", new URLSearchParams("limit=10"));
    expect(response.code).toBe(200);
    expect(response.data.source).toBe("kuaishou");
    expect(response.data.items[0]?.title).toBe("快手测试词");
    expect(response.data.items[0]?.url).toContain("abc123");

    vi.unstubAllGlobals();
  });

  test("returns rss from douyin local fallback when upstream rss fails", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("iesdouyin.com")) {
        return new Response(
          JSON.stringify({
            active_time: "2026-02-18 22:21:07",
            word_list: [{ word: "抖音RSS测试", hot_value: 101010 }],
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

    const result = await service.getCompatSource("douyin", new URLSearchParams("rss=true"));
    expect(result.type).toBe("rss");
    expect(result.body).toContain("<rss");
    expect(result.body).toContain("抖音RSS测试");

    vi.unstubAllGlobals();
  });
});
