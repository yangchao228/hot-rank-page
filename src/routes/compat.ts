import { Hono } from "hono";
import type { HotService } from "../services/hot-service.js";

export function createCompatRouter(service: HotService): Hono {
  const app = new Hono();

  app.get("/all", (c) => {
    const routes = service.listCompatRoutes();
    return c.json({
      code: 200,
      count: routes.length,
      routes,
    });
  });

  app.get("/:source", async (c) => {
    const source = c.req.param("source");
    const query = new URL(c.req.url).searchParams;
    const result = await service.getCompatSource(source, query);

    if (result.type === "rss") {
      c.header("content-type", "application/xml; charset=utf-8");
      return c.body(result.body, result.status as 200);
    }

    return c.json(result.body, result.status as 200);
  });

  return app;
}
