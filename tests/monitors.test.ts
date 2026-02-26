import { describe, expect, test } from "vitest";
import { createApp } from "../src/app.js";
import { SwrCache } from "../src/services/cache.js";
import { HotService } from "../src/services/hot-service.js";
import { MonitorService } from "../src/services/monitor-service.js";
import { InMemoryMonitorStateStore } from "../src/services/monitor-state.js";
import type { MonitorDefinition } from "../src/types/monitor.js";

function buildMockPayload(source: string) {
  return {
    code: 200,
    name: source,
    title: source,
    type: "hot",
    total: 3,
    data: [
      {
        id: `${source}-1`,
        title: `AI-${source}-1`,
        url: `https://example.com/${source}/1`,
        timestamp: "2026-02-26T00:00:00.000Z",
      },
      {
        id: `${source}-2`,
        title: `Other-${source}-2`,
        url: `https://example.com/${source}/2`,
        timestamp: "2026-02-26T00:01:00.000Z",
      },
    ],
  };
}

function makeTestApp() {
  const hotService = new HotService({
    cache: new SwrCache({ ttlSeconds: 60, staleSeconds: 60, useRedis: false }),
  });

  (hotService as unknown as { fetchLocalFallback: (source: string) => Promise<Record<string, unknown>> }).fetchLocalFallback =
    async (source: string) => buildMockPayload(source);

  let nowMs = Date.parse("2026-02-26T00:00:00.000Z");

  const monitors: MonitorDefinition[] = [
    {
      id: "ai-track",
      name: "AI 赛道",
      enabled: true,
      sources: ["weibo", "zhihu"],
      scheduleMinutes: 5,
      rule: {
        includeKeywords: ["AI"],
        excludeKeywords: [],
        fields: ["title", "desc"],
      },
      scoring: {
        persistenceWindowHours: 24,
        persistenceThreshold: 5,
        freshnessHalfLifeMinutes: 360,
      },
      outputs: {
        rss: { enabled: true, topN: 30 },
      },
    },
  ];

  const monitorService = new MonitorService({
    hotService,
    enabled: false,
    monitors,
    stateStore: new InMemoryMonitorStateStore(),
    nowFn: () => nowMs,
  });

  const app = createApp({
    hotService,
    monitorService,
    rateLimitWindowMs: 1000,
    rateLimitMax: 500,
    aggregateRateLimitMax: 500,
  });

  return {
    app,
    hotService,
    monitorService,
    setNow: (value: number) => {
      nowMs = value;
    },
  };
}

describe("Monitor routes", () => {
  test("GET /api/v1/monitors returns configured monitors", async () => {
    const { app } = makeTestApp();
    const response = await app.request("/api/v1/monitors");
    const json = (await response.json()) as { code: number; data: Array<{ id: string }> };

    expect(response.status).toBe(200);
    expect(json.code).toBe(200);
    expect(json.data.map((m) => m.id)).toContain("ai-track");
  });

  test("RSS uses persistenceThreshold by default (>=5)", async () => {
    const { app, monitorService, setNow } = makeTestApp();

    for (let i = 0; i < 5; i += 1) {
      setNow(Date.parse(`2026-02-26T00:${String(i).padStart(2, "0")}:00.000Z`));
      await monitorService.runMonitor("ai-track");
    }

    const response = await app.request("/api/v1/monitors/ai-track/rss");
    const xml = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")?.includes("application/xml")).toBe(true);
    expect(xml).toContain("<rss");
    expect(xml).toContain("AI-weibo-1");
  });

  test("Topics endpoint defaults to persistenceThreshold (>=5)", async () => {
    const { app, monitorService } = makeTestApp();

    await monitorService.runMonitor("ai-track");

    const response = await app.request("/api/v1/monitors/ai-track/topics");
    const json = (await response.json()) as { code: number; data: { items: unknown[] } };

    expect(response.status).toBe(200);
    expect(json.code).toBe(200);
    expect(json.data.items).toHaveLength(0);
  });

  test("Topics endpoint can override minCount", async () => {
    const { app, monitorService } = makeTestApp();

    await monitorService.runMonitor("ai-track");

    const response = await app.request("/api/v1/monitors/ai-track/topics?minCount=1&limit=10");
    const json = (await response.json()) as {
      code: number;
      data: { items: Array<{ title: string; last24hSeenCount: number }> };
    };

    expect(response.status).toBe(200);
    expect(json.code).toBe(200);
    expect(json.data.items.length).toBeGreaterThan(0);
    expect(json.data.items[0].last24hSeenCount).toBeGreaterThanOrEqual(1);
  });

  test("single source failure does not block monitor topic generation", async () => {
    const { app, monitorService, hotService } = makeTestApp();
    const original = hotService.getStandardFeed.bind(hotService);

    hotService.getStandardFeed = (async (source, query) => {
      if (source === "zhihu") {
        throw new Error("mock zhihu failure");
      }
      return original(source, query);
    }) as HotService["getStandardFeed"];

    await monitorService.runMonitor("ai-track");

    const response = await app.request("/api/v1/monitors/ai-track/topics?minCount=1");
    const json = (await response.json()) as { code: number; data: { items: Array<{ title: string }> } };

    expect(response.status).toBe(200);
    expect(json.code).toBe(200);
    expect(json.data.items.length).toBeGreaterThan(0);
    expect(json.data.items.some((item) => item.title.includes("AI-weibo"))).toBe(true);
  });

  test("refresh=true returns error when all sources fail", async () => {
    const { app, hotService } = makeTestApp();

    hotService.getStandardFeed = (async () => {
      throw new Error("all source failed");
    }) as HotService["getStandardFeed"];

    const response = await app.request("/api/v1/monitors/ai-track/topics?refresh=true&minCount=1");
    const json = (await response.json()) as { code: number; message: string };

    expect(response.status).toBe(500);
    expect(json.code).toBe(500);
    expect(json.message).toBe("Internal Server Error");
  });
});
