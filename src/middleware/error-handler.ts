import type { Context } from "hono";
import { logger } from "../utils/logger.js";

export class AppError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.status = status;
  }
}

export function formatErrorResponse(error: unknown, c: Context): Response {
  const requestId = c.res.headers.get("x-request-id") ?? c.req.header("x-request-id");

  if (error instanceof AppError) {
    logger.warn("request_failed", {
      requestId,
      status: error.status,
      path: c.req.path,
      message: error.message,
    });
    return c.json(
      {
        code: error.status,
        message: error.message,
      },
      error.status as 400,
    );
  }

  const message = error instanceof Error ? error.message : "Internal Server Error";

  logger.error("unhandled_error", {
    requestId,
    path: c.req.path,
    message,
  });

  return c.json(
    {
      code: 500,
      message: "Internal Server Error",
    },
    500 as 500,
  );
}
