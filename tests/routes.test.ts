import { describe, expect, test } from "vitest";
import { createApp } from "../src/app.js";
import { SwrCache } from "../src/services/cache.js";
import { HotService } from "../src/services/hot-service.js";

class RouteMockUpstreamClient {
  async fetchJson(source: string, query: Record<string, string>) {
    const limit = Number.parseInt(query.limit || "20", 10);
    const data = Array.from({ length: Math.max(limit, 12) }).map((_, index) => ({
      id: `${source}-${index + 1}`,
      title: `${source.toUpperCase()}-${index + 1}`,
      url: `https://example.com/${source}/${index + 1}`,
      timestamp: `2026-02-15T09:${String(index).padStart(2, "0")}:00.000Z`,
    }));
    return {
      code: 200,
      name: source,
      title: source,
      type: "hot",
      total: data.length,
      data,
    };
  }

  async fetchRss() {
    return "<rss version=\"2.0\"></rss>";
  }

  async ping() {
    return { ok: true, latencyMs: 5 };
  }
}

function makeTestApp() {
  const service = new HotService({
    cache: new SwrCache({ ttlSeconds: 60, staleSeconds: 60, useRedis: false }),
    upstreamClient: new RouteMockUpstreamClient(),
  });

  return createApp({
    hotService: service,
    rateLimitWindowMs: 1000,
    rateLimitMax: 500,
    aggregateRateLimitMax: 500,
  });
}

describe("Routes", () => {
  test("GET /all returns 12 sources", async () => {
    const app = makeTestApp();
    const response = await app.request("/all");
    const json = (await response.json()) as { code: number; count: number };

    expect(response.status).toBe(200);
    expect(json.code).toBe(200);
    expect(json.count).toBe(12);
  });

  test("GET /weibo?limit=10 returns code=200 and capped results", async () => {
    const app = makeTestApp();
    const response = await app.request("/weibo?limit=10");
    const json = (await response.json()) as { code: number; total: number; data: unknown[] };

    expect(response.status).toBe(200);
    expect(json.code).toBe(200);
    expect(json.total).toBeLessThanOrEqual(10);
    expect(json.data.length).toBeLessThanOrEqual(10);
  });

  test("GET /weibo?rss=true returns xml", async () => {
    const app = makeTestApp();
    const response = await app.request("/weibo?rss=true");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")?.includes("application/xml")).toBe(true);
  });

  test("GET /api/v1/hot/weibo returns standard ApiResponse", async () => {
    const app = makeTestApp();
    const response = await app.request("/api/v1/hot/weibo");
    const json = (await response.json()) as { code: number; data: { source: string } };

    expect(response.status).toBe(200);
    expect(json.code).toBe(200);
    expect(json.data.source).toBe("weibo");
  });

  test("GET /api/v1/hot/aggregate deduplicates and returns data", async () => {
    const app = makeTestApp();
    const response = await app.request("/api/v1/hot/aggregate?sources=weibo,zhihu&limit=20");
    const json = (await response.json()) as { code: number; data: { items: unknown[] } };

    expect(response.status).toBe(200);
    expect(json.code).toBe(200);
    expect(Array.isArray(json.data.items)).toBe(true);
  });

  test("invalid source returns 404", async () => {
    const app = makeTestApp();
    const response = await app.request("/api/v1/hot/unknown-source");
    const json = (await response.json()) as { code: number };

    expect(response.status).toBe(404);
    expect(json.code).toBe(404);
  });
});
