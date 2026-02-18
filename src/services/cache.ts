import { Redis } from "ioredis";
import { env } from "../config/env.js";
import type { CacheState, CachedEntry } from "../types/hot.js";
import { logger } from "../utils/logger.js";

interface CacheOptions {
  ttlSeconds?: number;
  staleSeconds?: number;
  useRedis?: boolean;
  redisUrl?: string;
  redisPrefix?: string;
}

interface CacheGetResult<T> {
  state: CacheState;
  entry?: CachedEntry<T>;
}

export class SwrCache {
  private memory = new Map<string, CachedEntry<unknown>>();

  private refreshLocks = new Map<string, Promise<void>>();

  private redis: Redis | null = null;

  private readonly ttlSeconds: number;

  private readonly staleSeconds: number;

  private readonly redisPrefix: string;

  constructor(options: CacheOptions = {}) {
    this.ttlSeconds = options.ttlSeconds ?? env.CACHE_TTL_SECONDS;
    this.staleSeconds = options.staleSeconds ?? env.CACHE_STALE_SECONDS;
    this.redisPrefix = options.redisPrefix ?? env.REDIS_PREFIX;

    const useRedis = options.useRedis ?? env.USE_REDIS;
    const redisUrl = options.redisUrl ?? env.REDIS_URL;

    if (useRedis && redisUrl) {
      this.redis = new Redis(redisUrl, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
      });
      this.redis.connect().catch((error: unknown) => {
        logger.warn("redis_connect_failed", {
          message: error instanceof Error ? error.message : String(error),
        });
        this.redis = null;
      });
    }
  }

  private namespacedKey(key: string): string {
    return `${this.redisPrefix}:${key}`;
  }

  async get<T>(key: string): Promise<CacheGetResult<T>> {
    const now = Date.now();

    let entry = this.memory.get(key) as CachedEntry<T> | undefined;

    if (!entry && this.redis) {
      try {
        const raw = await this.redis.get(this.namespacedKey(key));
        if (raw) {
          entry = JSON.parse(raw) as CachedEntry<T>;
          this.memory.set(key, entry as CachedEntry<unknown>);
        }
      } catch (error) {
        logger.warn("redis_get_failed", {
          key,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (!entry) {
      return { state: "miss" };
    }

    if (entry.expiresAt > now) {
      return { state: "fresh", entry };
    }

    if (entry.staleUntil > now) {
      return { state: "stale", entry };
    }

    await this.delete(key);
    return { state: "miss" };
  }

  async set<T>(
    key: string,
    value: T,
    ttlSeconds = this.ttlSeconds,
    staleSeconds = this.staleSeconds,
  ): Promise<CachedEntry<T>> {
    const now = Date.now();
    const entry: CachedEntry<T> = {
      value,
      updatedAt: now,
      expiresAt: now + ttlSeconds * 1000,
      staleUntil: now + (ttlSeconds + staleSeconds) * 1000,
    };

    this.memory.set(key, entry as CachedEntry<unknown>);

    if (this.redis) {
      try {
        const payload = JSON.stringify(entry);
        const ttl = ttlSeconds + staleSeconds;
        await this.redis.set(this.namespacedKey(key), payload, "EX", ttl);
      } catch (error) {
        logger.warn("redis_set_failed", {
          key,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return entry;
  }

  async delete(key: string): Promise<void> {
    this.memory.delete(key);
    if (!this.redis) {
      return;
    }
    try {
      await this.redis.del(this.namespacedKey(key));
    } catch (error) {
      logger.warn("redis_del_failed", {
        key,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async scheduleRefresh(key: string, refreshFn: () => Promise<void>): Promise<void> {
    const existing = this.refreshLocks.get(key);
    if (existing) {
      return existing;
    }

    const refreshing = refreshFn()
      .catch((error) => {
        logger.warn("cache_refresh_failed", {
          key,
          message: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        this.refreshLocks.delete(key);
      });

    this.refreshLocks.set(key, refreshing);
    return refreshing;
  }

  async health(): Promise<{ memoryKeys: number; redisEnabled: boolean; redisReady: boolean }> {
    let redisReady = false;
    if (this.redis) {
      redisReady = this.redis.status === "ready";
    }

    return {
      memoryKeys: this.memory.size,
      redisEnabled: Boolean(this.redis),
      redisReady,
    };
  }
}
