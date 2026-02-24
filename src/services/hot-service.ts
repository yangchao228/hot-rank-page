import {
  SOURCE_DEFINITIONS,
  isSupportedSource,
  listCompatRoutes,
  pickAllowedQuery,
  type SourceId,
} from "../domain/sources.js";
import { AppError } from "../middleware/error-handler.js";
import type {
  AggregateHotData,
  ApiResponse,
  HotFeed,
  HotItem,
  UpstreamHotPayload,
} from "../types/hot.js";
import { SwrCache } from "./cache.js";
import { fetchZhihuHotList } from "./local/zhihu.js";
import { fetchDouyinHotList } from "./local/douyin.js";
import { fetchKuaishouHotList } from "./local/kuaishou.js";
import { fetchWeiboHotList } from "./local/weibo.js";
import { fetchBaiduHotList } from "./local/baidu.js";
import { fetchBilibiliHotList } from "./local/bilibili.js";
import { fetch36KrHotList } from "./local/kr36.js";
import { fetchToutiaoHotList } from "./local/toutiao.js";
import { fetchV2exHotList } from "./local/v2ex.js";
import { buildRssXml } from "../utils/rss.js";

interface HotServiceDeps {
  cache?: SwrCache;
  // Deprecated: retained for test/backward compatibility, ignored in local-only mode.
  upstreamClient?: unknown;
}

interface CompatJsonResult {
  type: "json";
  status: 200;
  body: Record<string, unknown>;
}

interface CompatRssResult {
  type: "rss";
  status: 200;
  body: string;
}

export type CompatResult = CompatJsonResult | CompatRssResult;

const LOCAL_FALLBACK_TIMEOUT_MS = 8000;
const SCHEDULE_REFRESH_INTERVAL_MS = 60 * 60 * 1000;
const SCHEDULE_JITTER_MAX_MS = 5 * 60 * 1000;
const SCHEDULE_RETRY_INTERVAL_MS = 5 * 60 * 1000;
const SCHEDULE_MAX_CONSECUTIVE_FAILURES = 3;
const SCHEDULE_CACHE_TTL_SECONDS = 60 * 60;
const SCHEDULE_CACHE_STALE_SECONDS = 30 * 60;

interface SourceRefreshState {
  source: SourceId;
  nextRunAt?: string;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastError?: string;
  consecutiveFailures: number;
  retriesInCurrentCycle: number;
  totalRefreshes: number;
  totalFailures: number;
  gaveUpInCurrentCycle: boolean;
  recentPulls: SourceRefreshAttempt[];
}

interface SourceRefreshAttempt {
  at: string;
  status: "success" | "failure";
  mode: "refresh" | "retry";
  durationMs: number;
  error?: string;
}

type LocalFallbackSource = "weibo" | "zhihu" | "douyin" | "kuaishou";

function isLocalFallbackSource(source: SourceId): source is LocalFallbackSource {
  return source === "weibo" || source === "zhihu" || source === "douyin" || source === "kuaishou";
}

function toNumericLimit(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function toRecordFromQuery(query: URLSearchParams): Record<string, string> {
  const record: Record<string, string> = {};
  query.forEach((value, key) => {
    record[key] = value;
  });
  return record;
}

function normalizeTimestamp(input: unknown): string | undefined {
  if (typeof input !== "string" || input.trim() === "") {
    return undefined;
  }
  const millis = Date.parse(input);
  if (!Number.isFinite(millis)) {
    return undefined;
  }
  return new Date(millis).toISOString();
}

function toStringOrUndefined(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return undefined;
}

function applyCompatLimit(payload: Record<string, unknown>, limit: number): void {
  const data = payload["data"];
  if (Array.isArray(data) && data.length > limit) {
    payload["data"] = data.slice(0, limit);
    payload["total"] = (payload["data"] as unknown[]).length;
  }
}

function buildRssFromCompatPayload(source: SourceId, payload: Record<string, unknown>): string {
  const defaultMeta: Record<SourceId, { title: string; link: string; description: string }> = {
    douyin: { title: "抖音热榜", link: "https://www.douyin.com/hot", description: "抖音热榜" },
    kuaishou: { title: "快手热榜", link: "https://www.kuaishou.com/", description: "快手热榜" },
    weibo: { title: "微博热搜", link: "https://s.weibo.com/top/summary", description: "微博热搜榜" },
    zhihu: { title: "知乎热榜", link: "https://www.zhihu.com/hot", description: "知乎热榜" },
    baidu: { title: "百度热搜", link: "https://top.baidu.com/board?tab=realtime", description: "百度热搜榜" },
    bilibili: { title: "哔哩哔哩热门榜", link: "https://www.bilibili.com/v/popular/all", description: "B 站热门榜" },
    "36kr": { title: "36 氪热榜", link: "https://www.36kr.com/hot-list/catalog", description: "36 氪热榜" },
    toutiao: { title: "头条热榜", link: "https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc", description: "今日头条热榜" },
    v2ex: { title: "V2EX 热榜", link: "https://www.v2ex.com/?tab=hot", description: "V2EX 热榜" },
  };

  const meta = defaultMeta[source];

  return buildRssXml({
    title: String(payload["title"] ?? meta.title),
    link: String(payload["link"] ?? meta.link),
    description: String(payload["description"] ?? meta.description),
    items:
      (payload["data"] as Array<Record<string, unknown>> | undefined)?.map((item) => ({
        title: String(item.title ?? ""),
        link: String(item.url ?? ""),
        description: String(item.desc ?? ""),
        pubDate: item.timestamp ? String(item.timestamp) : undefined,
      })) ?? [],
  });
}

export class HotService {
  private readonly cache: SwrCache;
  private schedulerStarted = false;
  private schedulerEnabled = process.env.NODE_ENV !== "test";
  private readonly schedulerTimers = new Map<SourceId, ReturnType<typeof setTimeout>>();
  private readonly schedulerStates = new Map<SourceId, SourceRefreshState>();

  constructor(deps: HotServiceDeps = {}) {
    this.cache = deps.cache ?? new SwrCache();
    for (const source of SOURCE_DEFINITIONS) {
      this.schedulerStates.set(source.id, {
        source: source.id,
        consecutiveFailures: 0,
        retriesInCurrentCycle: 0,
        totalRefreshes: 0,
        totalFailures: 0,
        gaveUpInCurrentCycle: false,
        recentPulls: [],
      });
    }
  }

  listSources() {
    return SOURCE_DEFINITIONS;
  }

  listCompatRoutes() {
    return listCompatRoutes();
  }

  private buildCompatQuery(source: SourceId, query: Record<string, string>): Record<string, string> {
    const sourceParams = pickAllowedQuery(source, query);
    const compat: Record<string, string> = {};
    for (const key of ["limit", "cache", "rss"]) {
      if (query[key]) {
        compat[key] = query[key];
      }
    }
    return {
      ...sourceParams,
      ...compat,
    };
  }

  private buildJsonQuery(source: SourceId, query: Record<string, string>): Record<string, string> {
    const sourceParams = pickAllowedQuery(source, query);
    const jsonQuery: Record<string, string> = {
      ...sourceParams,
    };
    if (query.limit) {
      jsonQuery.limit = query.limit;
    }
    if (query.cache) {
      jsonQuery.cache = query.cache;
    }
    return jsonQuery;
  }

  private cacheKey(source: SourceId, query: Record<string, string>, format: "json" | "rss"): string {
    const sorted = Object.entries(query)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("&");
    return `${source}:${format}:${sorted}`;
  }

  private normalizedCacheKey(
    source: SourceId,
    query: Record<string, string>,
    format: "json" | "rss",
  ): string {
    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(query)) {
      if (key === "limit" || key === "cache" || key === "rss") continue;
      normalized[key] = value;
    }
    return this.cacheKey(source, normalized, format);
  }

  private async fetchLocalFallback(source: SourceId): Promise<Record<string, unknown>> {
    if (source === "weibo") {
      return fetchWeiboHotList(LOCAL_FALLBACK_TIMEOUT_MS) as unknown as Record<string, unknown>;
    }
    if (source === "zhihu") {
      return fetchZhihuHotList(LOCAL_FALLBACK_TIMEOUT_MS) as unknown as Record<string, unknown>;
    }
    if (source === "douyin") {
      return fetchDouyinHotList(LOCAL_FALLBACK_TIMEOUT_MS) as unknown as Record<string, unknown>;
    }
    if (source === "kuaishou") {
      return fetchKuaishouHotList(LOCAL_FALLBACK_TIMEOUT_MS) as unknown as Record<string, unknown>;
    }
    if (source === "baidu") {
      return fetchBaiduHotList(LOCAL_FALLBACK_TIMEOUT_MS) as unknown as Record<string, unknown>;
    }
    if (source === "bilibili") {
      return fetchBilibiliHotList(LOCAL_FALLBACK_TIMEOUT_MS) as unknown as Record<string, unknown>;
    }
    if (source === "36kr") {
      return fetch36KrHotList(LOCAL_FALLBACK_TIMEOUT_MS) as unknown as Record<string, unknown>;
    }
    if (source === "toutiao") {
      return fetchToutiaoHotList(LOCAL_FALLBACK_TIMEOUT_MS) as unknown as Record<string, unknown>;
    }
    if (source === "v2ex") {
      return fetchV2exHotList(LOCAL_FALLBACK_TIMEOUT_MS) as unknown as Record<string, unknown>;
    }
    throw new Error(`No local fallback implementation for source ${source}`);
  }

  private schedulerJitterMs(): number {
    return Math.floor(Math.random() * (SCHEDULE_JITTER_MAX_MS + 1));
  }

  private setSchedulerState(source: SourceId, patch: Partial<SourceRefreshState>): void {
    const current = this.schedulerStates.get(source) ?? {
      source,
      consecutiveFailures: 0,
      retriesInCurrentCycle: 0,
      totalRefreshes: 0,
      totalFailures: 0,
      gaveUpInCurrentCycle: false,
      recentPulls: [],
    };
    this.schedulerStates.set(source, { ...current, ...patch });
  }

  private pushSchedulerPullHistory(source: SourceId, item: SourceRefreshAttempt): void {
    const current = this.schedulerStates.get(source);
    const recentPulls = [item, ...(current?.recentPulls ?? [])].slice(0, 3);
    this.setSchedulerState(source, { recentPulls });
  }

  private clearScheduledTimer(source: SourceId): void {
    const timer = this.schedulerTimers.get(source);
    if (timer) {
      clearTimeout(timer);
      this.schedulerTimers.delete(source);
    }
  }

  private scheduleSourceRun(
    source: SourceId,
    delayMs: number,
    mode: "refresh" | "retry",
    cycleStartedAt: number,
  ): void {
    this.clearScheduledTimer(source);
    const nextRunAt = new Date(Date.now() + Math.max(0, delayMs)).toISOString();
    this.setSchedulerState(source, { nextRunAt });
    const timer = setTimeout(() => {
      void this.runScheduledRefresh(source, mode, cycleStartedAt);
    }, Math.max(0, delayMs));
    if (typeof timer.unref === "function") {
      timer.unref();
    }
    this.schedulerTimers.set(source, timer);
  }

  private async warmDefaultSourceCache(source: SourceId): Promise<void> {
    const payload = await this.fetchLocalFallback(source);
    await this.cache.set(
      this.normalizedCacheKey(source, {}, "json"),
      payload,
      SCHEDULE_CACHE_TTL_SECONDS,
      SCHEDULE_CACHE_STALE_SECONDS,
    );
  }

  private async runScheduledRefresh(
    source: SourceId,
    mode: "refresh" | "retry",
    cycleStartedAt: number,
  ): Promise<void> {
    const state = this.schedulerStates.get(source);
    if (!state) return;
    const runStartedAt = Date.now();

    try {
      await this.warmDefaultSourceCache(source);
      const completedAt = new Date().toISOString();
      this.pushSchedulerPullHistory(source, {
        at: completedAt,
        status: "success",
        mode,
        durationMs: Date.now() - runStartedAt,
      });
      this.setSchedulerState(source, {
        consecutiveFailures: 0,
        retriesInCurrentCycle: 0,
        totalRefreshes: state.totalRefreshes + 1,
        gaveUpInCurrentCycle: false,
        lastSuccessAt: completedAt,
        lastError: undefined,
      });

      const nextDelay = SCHEDULE_REFRESH_INTERVAL_MS + this.schedulerJitterMs();
      this.scheduleSourceRun(source, nextDelay, "refresh", Date.now());
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const completedAt = new Date().toISOString();
      this.pushSchedulerPullHistory(source, {
        at: completedAt,
        status: "failure",
        mode,
        durationMs: Date.now() - runStartedAt,
        error: message,
      });
      const nextFailures = state.consecutiveFailures + 1;
      const nextRetries = mode === "retry" ? state.retriesInCurrentCycle + 1 : 1;
      this.setSchedulerState(source, {
        consecutiveFailures: nextFailures,
        retriesInCurrentCycle: nextRetries,
        totalFailures: state.totalFailures + 1,
        lastFailureAt: completedAt,
        lastError: message,
      });

      if (nextFailures >= SCHEDULE_MAX_CONSECUTIVE_FAILURES) {
        // Give up this cycle and wait for the next hourly refresh window.
        const elapsed = Date.now() - cycleStartedAt;
        const waitUntilNextCycle = Math.max(0, SCHEDULE_REFRESH_INTERVAL_MS - elapsed) + this.schedulerJitterMs();
        this.setSchedulerState(source, {
          gaveUpInCurrentCycle: true,
          retriesInCurrentCycle: 0,
        });
        this.scheduleSourceRun(source, waitUntilNextCycle, "refresh", Date.now());
        return;
      }

      this.scheduleSourceRun(source, SCHEDULE_RETRY_INTERVAL_MS, "retry", cycleStartedAt);
    }
  }

  startBackgroundRefreshScheduler(): void {
    if (!this.schedulerEnabled || this.schedulerStarted) {
      return;
    }
    this.schedulerStarted = true;
    const startedAt = Date.now();
    for (const source of SOURCE_DEFINITIONS) {
      this.scheduleSourceRun(source.id, this.schedulerJitterMs(), "refresh", startedAt);
    }
  }

  stopBackgroundRefreshScheduler(): void {
    this.schedulerStarted = false;
    for (const source of SOURCE_DEFINITIONS) {
      this.clearScheduledTimer(source.id);
    }
  }

  private async loadWithSWR<T>(
    key: string,
    noCache: boolean,
    loader: () => Promise<T>,
  ): Promise<{ value: T; fromCache: boolean; updateTime: string }> {
    if (noCache) {
      const value = await loader();
      const entry = await this.cache.set(key, value);
      return {
        value,
        fromCache: false,
        updateTime: new Date(entry.updatedAt).toISOString(),
      };
    }

    const cached = await this.cache.get<T>(key);

    if (cached.state === "fresh" && cached.entry) {
      return {
        value: cached.entry.value,
        fromCache: true,
        updateTime: new Date(cached.entry.updatedAt).toISOString(),
      };
    }

    if (cached.state === "stale" && cached.entry) {
      void this.cache.scheduleRefresh(key, async () => {
        const fresh = await loader();
        await this.cache.set(key, fresh);
      });
      return {
        value: cached.entry.value,
        fromCache: true,
        updateTime: new Date(cached.entry.updatedAt).toISOString(),
      };
    }

    const value = await loader();
    const entry = await this.cache.set(key, value);

    return {
      value,
      fromCache: false,
      updateTime: new Date(entry.updatedAt).toISOString(),
    };
  }

  async getCompatSource(sourceInput: string, query: URLSearchParams): Promise<CompatResult> {
    if (!isSupportedSource(sourceInput)) {
      throw new AppError("Source Not Found", 404);
    }

    const source = sourceInput;
    const queryRecord = toRecordFromQuery(query);
    const compatQuery = this.buildCompatQuery(source, queryRecord);
    const noCache = compatQuery.cache === "false";
    const wantsRss = compatQuery.rss === "true";
    const key = this.normalizedCacheKey(source, compatQuery, wantsRss ? "rss" : "json");

    try {
      const result = await this.loadWithSWR(key, noCache, () => this.fetchLocalFallback(source));

      const payload = {
        code: 200,
        ...result.value,
        fromCache: result.fromCache,
        updateTime: result.updateTime,
      } as Record<string, unknown>;

      const limit = toNumericLimit(compatQuery.limit, Number.MAX_SAFE_INTEGER);
      const data = payload["data"];
      if (Array.isArray(data) && data.length > limit) {
        payload["data"] = data.slice(0, limit);
        payload["total"] = (payload["data"] as unknown[]).length;
      }

      if (wantsRss) {
        return {
          type: "rss",
          status: 200,
          body: buildRssFromCompatPayload(source, payload),
        };
      }

      return {
        type: "json",
        status: 200,
        body: payload,
      };
    } catch {
      throw new AppError("Failed to fetch local source", 502);
    }
  }

  private normalizeFeed(source: SourceId, payload: UpstreamHotPayload, fromCache: boolean, updateTime: string): HotFeed {
    const rows = Array.isArray(payload.data) ? payload.data : [];

    const items: HotItem[] = rows.map((item, index) => {
      const row = (item ?? {}) as Record<string, unknown>;
      const title = toStringOrUndefined(row.title) || toStringOrUndefined(row.desc) || "(untitled)";
      const rawId = toStringOrUndefined(row.id);
      const url = toStringOrUndefined(row.url) || toStringOrUndefined(row.link);
      const mobileUrl = toStringOrUndefined(row.mobileUrl) || toStringOrUndefined(row.mobile_url);

      return {
        id: rawId || `${source}-${index + 1}`,
        title,
        url,
        mobileUrl,
        desc: toStringOrUndefined(row.desc) || toStringOrUndefined(row.description),
        hot: (typeof row.hot === "number" || typeof row.hot === "string") ? row.hot : undefined,
        timestamp: normalizeTimestamp(row.timestamp),
        source,
        raw: row,
      };
    });

    return {
      source,
      title: payload.title || source,
      type: payload.type,
      link: payload.link,
      total: typeof payload.total === "number" ? payload.total : items.length,
      fromCache,
      updateTime,
      items,
    };
  }

  async getStandardFeed(sourceInput: string, query: URLSearchParams): Promise<ApiResponse<HotFeed>> {
    if (!isSupportedSource(sourceInput)) {
      throw new AppError("Source Not Found", 404);
    }

    const source = sourceInput;
    const queryRecord = toRecordFromQuery(query);
    const jsonQuery = this.buildJsonQuery(source, queryRecord);
    const noCache = jsonQuery.cache === "false";
    const key = this.normalizedCacheKey(source, jsonQuery, "json");

    try {
      const result = await this.loadWithSWR(key, noCache, () => this.fetchLocalFallback(source));
      const feed = this.normalizeFeed(
        source,
        result.value as UpstreamHotPayload,
        result.fromCache,
        result.updateTime,
      );

      const limit = toNumericLimit(jsonQuery.limit, Number.MAX_SAFE_INTEGER);
      if (feed.items.length > limit) {
        feed.items = feed.items.slice(0, limit);
        feed.total = feed.items.length;
      }

      return {
        code: 200,
        message: "ok",
        data: feed,
      };
    } catch {
      throw new AppError("Failed to fetch local source", 502);
    }
  }

  async getAggregateFeed(query: URLSearchParams): Promise<ApiResponse<AggregateHotData>> {
    const queryRecord = toRecordFromQuery(query);
    const requestedSources = (queryRecord.sources || "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const limit = toNumericLimit(queryRecord.limit, 50);

    const candidates =
      requestedSources.length > 0
        ? requestedSources.filter((source): source is SourceId => isSupportedSource(source))
        : SOURCE_DEFINITIONS.map((source) => source.id);

    if (candidates.length === 0) {
      throw new AppError("No valid sources provided", 400);
    }

    const failedSources: string[] = [];
    const feeds = await Promise.all(
      candidates.map(async (source) => {
        try {
          const response = await this.getStandardFeed(source, new URLSearchParams(queryRecord));
          return response.data;
        } catch {
          failedSources.push(source);
          return null;
        }
      }),
    );

    const merged = feeds
      .filter((feed): feed is HotFeed => feed !== null)
      .flatMap((feed) => feed.items);

    const deduplicated = new Map<string, HotItem>();
    for (const item of merged) {
      const key = item.url?.trim() ? `url:${item.url.trim()}` : `title:${item.title.trim().toLowerCase()}`;
      if (!deduplicated.has(key)) {
        deduplicated.set(key, item);
      }
    }

    const items = Array.from(deduplicated.values())
      .sort((a, b) => {
        const at = a.timestamp ? Date.parse(a.timestamp) : 0;
        const bt = b.timestamp ? Date.parse(b.timestamp) : 0;
        return bt - at;
      })
      .slice(0, limit);

    const data: AggregateHotData = {
      sources: candidates,
      total: items.length,
      updateTime: new Date().toISOString(),
      failedSources,
      items,
    };

    return {
      code: 200,
      message: "ok",
      data,
    };
  }

  async health() {
    const cache = await this.cache.health();
    return {
      status: "ok" as const,
      mode: "local-only" as const,
      localSources: SOURCE_DEFINITIONS.map((source) => source.id),
      scheduler: {
        enabled: this.schedulerEnabled,
        started: this.schedulerStarted,
        refreshIntervalMs: SCHEDULE_REFRESH_INTERVAL_MS,
        retryIntervalMs: SCHEDULE_RETRY_INTERVAL_MS,
        maxConsecutiveFailures: SCHEDULE_MAX_CONSECUTIVE_FAILURES,
        jitterMaxMs: SCHEDULE_JITTER_MAX_MS,
        sources: Array.from(this.schedulerStates.values()),
      },
      upstream: {
        ok: true,
        latencyMs: 0,
        disabled: true,
        message: "DailyHotApi disabled (local-only mode)",
      },
      cache,
    };
  }
}
