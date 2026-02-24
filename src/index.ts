import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { HotService } from "./services/hot-service.js";
import { logger } from "./utils/logger.js";

const hotService = new HotService();
hotService.startBackgroundRefreshScheduler();

const app = createApp({
  hotService,
});

serve({
  fetch: app.fetch,
  port: env.PORT,
});

logger.info("server_started", {
  port: env.PORT,
  env: env.NODE_ENV,
});
