import type { MiddlewareHandler } from "hono";

function generateRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export const requestIdMiddleware: MiddlewareHandler = async (c, next) => {
  const incomingId = c.req.header("x-request-id");
  const requestId = incomingId?.trim() || generateRequestId();
  c.header("x-request-id", requestId);
  await next();
};
