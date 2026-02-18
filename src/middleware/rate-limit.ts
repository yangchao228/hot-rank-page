import type { MiddlewareHandler } from "hono";

interface RateLimitOptions {
  windowMs: number;
  max: number;
  scope: string;
  skip?: (path: string) => boolean;
}

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

function getClientIp(headers: Headers): string {
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }

  const realIp = headers.get("x-real-ip");
  return realIp?.trim() || "unknown";
}

export function createRateLimitMiddleware(options: RateLimitOptions): MiddlewareHandler {
  const { windowMs, max, scope, skip } = options;

  return async (c, next) => {
    if (skip?.(c.req.path)) {
      await next();
      return;
    }

    const ip = getClientIp(c.req.raw.headers);
    const key = `${scope}:${ip}`;
    const now = Date.now();
    const current = buckets.get(key);

    if (!current || current.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      c.header("x-ratelimit-limit", String(max));
      c.header("x-ratelimit-remaining", String(max - 1));
      c.header("x-ratelimit-reset", String(now + windowMs));
      await next();
      return;
    }

    if (current.count >= max) {
      c.header("x-ratelimit-limit", String(max));
      c.header("x-ratelimit-remaining", "0");
      c.header("x-ratelimit-reset", String(current.resetAt));
      return c.json(
        {
          code: 429,
          message: "Too Many Requests",
        },
        429,
      );
    }

    current.count += 1;
    buckets.set(key, current);
    c.header("x-ratelimit-limit", String(max));
    c.header("x-ratelimit-remaining", String(Math.max(0, max - current.count)));
    c.header("x-ratelimit-reset", String(current.resetAt));
    await next();
  };
}

export function resetRateLimitStore(): void {
  buckets.clear();
}
