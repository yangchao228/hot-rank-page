import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(6688),
  ZHIHU_COOKIE: z.string().default(""),
  CACHE_TTL_SECONDS: z.coerce.number().int().min(1).default(300),
  CACHE_STALE_SECONDS: z.coerce.number().int().min(1).default(1800),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().min(500).default(6000),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60000),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(120),
  AGGREGATE_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(30),
  USE_REDIS: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  REDIS_URL: z.string().default(""),
  REDIS_PREFIX: z.string().default("hot-rank"),
  CORS_ORIGIN: z.string().default("*"),
});

export type Env = z.infer<typeof envSchema>;

export const env: Env = envSchema.parse(process.env);
