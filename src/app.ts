import { Hono } from "hono";
import { cors } from "hono/cors";
import { env } from "./config/env.js";
import { formatErrorResponse } from "./middleware/error-handler.js";
import { createRateLimitMiddleware } from "./middleware/rate-limit.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { createCompatRouter } from "./routes/compat.js";
import { createUiRouter } from "./routes/ui.js";
import { createV1Router } from "./routes/v1.js";
import { HotService } from "./services/hot-service.js";
import type { MonitorService } from "./services/monitor-service.js";
import { logger } from "./utils/logger.js";

interface CreateAppOptions {
  hotService?: HotService;
  monitorService?: MonitorService;
  rateLimitWindowMs?: number;
  rateLimitMax?: number;
  aggregateRateLimitMax?: number;
}

export function createApp(options: CreateAppOptions = {}): Hono {
  const app = new Hono();
  const service = options.hotService ?? new HotService();

  app.use("*", requestIdMiddleware);
  app.use("*", async (c, next) => {
    const start = Date.now();
    await next();
    const requestId = c.res.headers.get("x-request-id") ?? c.req.header("x-request-id");
    logger.info("request", {
      requestId,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Date.now() - start,
    });
  });
  app.use(
    "*",
    cors({
      origin: env.CORS_ORIGIN,
      allowMethods: ["GET", "OPTIONS"],
      allowHeaders: ["Content-Type", "X-Request-Id"],
    }),
  );

  app.use(
    "/api/*",
    createRateLimitMiddleware({
      windowMs: options.rateLimitWindowMs ?? env.RATE_LIMIT_WINDOW_MS,
      max: options.rateLimitMax ?? env.RATE_LIMIT_MAX,
      scope: "api",
    }),
  );

  app.use(
    "/api/v1/hot/aggregate",
    createRateLimitMiddleware({
      windowMs: options.rateLimitWindowMs ?? env.RATE_LIMIT_WINDOW_MS,
      max: options.aggregateRateLimitMax ?? env.AGGREGATE_RATE_LIMIT_MAX,
      scope: "aggregate",
    }),
  );

  app.use(
    "/all",
    createRateLimitMiddleware({
      windowMs: options.rateLimitWindowMs ?? env.RATE_LIMIT_WINDOW_MS,
      max: options.rateLimitMax ?? env.RATE_LIMIT_MAX,
      scope: "compat-all",
    }),
  );

  app.use(
    "/:source",
    createRateLimitMiddleware({
      windowMs: options.rateLimitWindowMs ?? env.RATE_LIMIT_WINDOW_MS,
      max: options.rateLimitMax ?? env.RATE_LIMIT_MAX,
      scope: "compat-source",
      skip: (path) => ["/healthz", "/app.js", "/styles.css", "/favicon.ico"].includes(path),
    }),
  );

  app.get("/healthz", async (c) => {
    const health = await service.health();
    const statusCode = health.status === "ok" ? 200 : 503;
    return c.json({ code: statusCode, message: health.status, data: health }, statusCode);
  });

  app.route("/", createUiRouter());
  app.route("/api/v1", createV1Router(service, options.monitorService));
  app.route("/", createCompatRouter(service));

  app.notFound((c) => {
    return c.json(
      {
        code: 404,
        message: "Not Found",
      },
      404,
    );
  });

  app.onError((error, c) => formatErrorResponse(error, c));

  return app;
}
