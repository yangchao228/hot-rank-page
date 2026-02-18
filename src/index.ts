import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./utils/logger.js";

const app = createApp();

serve({
  fetch: app.fetch,
  port: env.PORT,
});

logger.info("server_started", {
  port: env.PORT,
  env: env.NODE_ENV,
});
