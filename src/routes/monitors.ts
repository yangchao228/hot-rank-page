import { Hono } from "hono";
import type { MonitorService } from "../services/monitor-service.js";

function toPositiveInt(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export function createMonitorRouter(service: MonitorService): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const monitors = await service.listMonitors();
    return c.json(
      {
        code: 200,
        message: "ok",
        data: monitors.map((monitor) => ({
          id: monitor.id,
          name: monitor.name,
          enabled: monitor.enabled,
          sources: monitor.sources,
          scheduleMinutes: monitor.scheduleMinutes,
          outputs: monitor.outputs,
          scoring: monitor.scoring,
        })),
      },
      200,
    );
  });

  app.get("/:id/topics", async (c) => {
    const id = c.req.param("id");
    const query = new URL(c.req.url).searchParams;
    const limit = toPositiveInt(query.get("limit"), 30);
    const refresh = query.get("refresh") === "true";
    const minCount = query.get("minCount") ? toPositiveInt(query.get("minCount"), 1) : undefined;
    const topics = await service.listTopics(id, { limit, refresh, minLast24hSeenCount: minCount });
    return c.json(
      {
        code: 200,
        message: "ok",
        data: {
          monitorId: id,
          generatedAt: new Date().toISOString(),
          items: topics,
        },
      },
      200,
    );
  });

  app.get("/:id/rss", async (c) => {
    const id = c.req.param("id");
    const query = new URL(c.req.url).searchParams;
    const limit = toPositiveInt(query.get("limit"), 30);
    const refresh = query.get("refresh") === "true";
    const minCount = query.get("minCount") ? toPositiveInt(query.get("minCount"), 1) : undefined;
    const xml = await service.buildRss(id, c.req.url, { limit, refresh, minCount });
    c.header("content-type", "application/xml; charset=utf-8");
    return c.body(xml, 200);
  });

  return app;
}
