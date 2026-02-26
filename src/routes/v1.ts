import { Hono } from "hono";
import type { HotService } from "../services/hot-service.js";
import type { MonitorService } from "../services/monitor-service.js";
import { createMonitorRouter } from "./monitors.js";

export function createV1Router(service: HotService, monitorService?: MonitorService): Hono {
  const app = new Hono();

  app.get("/sources", (c) => {
    return c.json({
      code: 200,
      message: "ok",
      data: service.listSources(),
    });
  });

  app.get("/hot/aggregate", async (c) => {
    const query = new URL(c.req.url).searchParams;
    const response = await service.getAggregateFeed(query);
    return c.json(response, 200);
  });

  app.get("/hot/:source", async (c) => {
    const source = c.req.param("source");
    const query = new URL(c.req.url).searchParams;
    const response = await service.getStandardFeed(source, query);
    return c.json(response, 200);
  });

  if (monitorService) {
    app.route("/monitors", createMonitorRouter(monitorService));
  }

  return app;
}
