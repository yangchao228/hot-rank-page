import type { HotService } from "./hot-service.js";
import { AppError } from "../middleware/error-handler.js";
import { SOURCE_MAP, type SourceId } from "../domain/sources.js";
import { buildRssXml } from "../utils/rss.js";
import { logger } from "../utils/logger.js";
import { readMonitorDefinitions } from "./monitor-config.js";
import {
  FileBackedMonitorStateStore,
  type MonitorStateStore,
  type TopicStateRecord,
} from "./monitor-state.js";
import type { MonitorDefinition, MonitorId, MonitorTopic } from "../types/monitor.js";

const DEFAULT_QUERY_LIMIT = 50;

interface MonitorServiceOptions {
  hotService: HotService;
  monitors?: MonitorDefinition[];
  configPath?: string;
  statePath?: string;
  stateStore?: MonitorStateStore;
  enabled?: boolean;
  nowFn?: () => number;
}

function normalizeText(input: string): string {
  return input.trim().toLowerCase();
}

function buildTopicKey(item: { url?: string; title: string }): string {
  const url = item.url?.trim();
  if (url) return `url:${url}`;
  return `title:${normalizeText(item.title)}`;
}

function pruneSortedOccurrences(occurrences: number[], cutoffMs: number): number[] {
  let start = 0;
  while (start < occurrences.length) {
    const value = occurrences[start];
    if (value === undefined || value >= cutoffMs) break;
    start += 1;
  }
  return start === 0 ? occurrences : occurrences.slice(start);
}

function computeFreshnessScore(ageMs: number, halfLifeMs: number): number {
  if (halfLifeMs <= 0) return 0;
  if (ageMs <= 0) return 1;
  // score halves every halfLifeMs
  return Math.exp(-Math.log(2) * (ageMs / halfLifeMs));
}

function computePersistenceScore(last24hSeenCount: number): number {
  return Math.log(1 + Math.max(0, last24hSeenCount));
}

function matchItem(
  rule: MonitorDefinition["rule"],
  item: { title: string; desc?: string },
): { ok: boolean; reason: string[] } {
  const fields = new Set(rule.fields ?? ["title", "desc"]);
  const text = [
    fields.has("title") ? item.title : "",
    fields.has("desc") ? (item.desc ?? "") : "",
  ]
    .filter(Boolean)
    .join("\n");

  const haystack = normalizeText(text);
  const reasons: string[] = [];

  const includeKeywords = (rule.includeKeywords ?? []).map((k) => k.trim()).filter(Boolean);
  const excludeKeywords = (rule.excludeKeywords ?? []).map((k) => k.trim()).filter(Boolean);

  for (const keyword of excludeKeywords) {
    if (haystack.includes(normalizeText(keyword))) {
      return { ok: false, reason: [] };
    }
  }

  if (rule.excludeRegex) {
    try {
      const re = new RegExp(rule.excludeRegex, "i");
      if (re.test(text)) return { ok: false, reason: [] };
    } catch {
      // ignore invalid regex; config validation should prevent this
    }
  }

  let includeHit = includeKeywords.length === 0 && !rule.includeRegex;
  for (const keyword of includeKeywords) {
    if (haystack.includes(normalizeText(keyword))) {
      includeHit = true;
      reasons.push(`kw:${keyword}`);
    }
  }

  if (rule.includeRegex) {
    try {
      const re = new RegExp(rule.includeRegex, "i");
      if (re.test(text)) {
        includeHit = true;
        reasons.push(`re:${rule.includeRegex}`);
      }
    } catch {
      // ignore invalid regex; config validation should prevent this
    }
  }

  return { ok: includeHit, reason: reasons };
}

export class MonitorService {
  private readonly hotService: HotService;
  private readonly configPath?: string;
  private readonly stateStore: MonitorStateStore;
  private readonly enabled: boolean;
  private readonly nowFn: () => number;

  private readonly ready: Promise<void>;
  private monitors: MonitorDefinition[] = [];
  private readonly timers = new Map<MonitorId, ReturnType<typeof setInterval>>();
  private readonly startupTimers = new Map<MonitorId, ReturnType<typeof setTimeout>>();
  private readonly running = new Set<MonitorId>();

  constructor(options: MonitorServiceOptions) {
    this.hotService = options.hotService;
    this.configPath = options.configPath;
    this.stateStore = options.stateStore ?? new FileBackedMonitorStateStore(options.statePath ?? "data/monitor-state.json");
    this.enabled = options.enabled ?? process.env.NODE_ENV !== "test";
    this.nowFn = options.nowFn ?? (() => Date.now());
    this.monitors = options.monitors ?? [];
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    if (this.monitors.length === 0) {
      if (!this.configPath) {
        throw new Error("MonitorService requires either monitors[] or configPath");
      }
      this.monitors = await readMonitorDefinitions(this.configPath);
    }
    await this.stateStore.load();
  }

  async listMonitors(): Promise<MonitorDefinition[]> {
    await this.ready;
    return this.monitors;
  }

  private async getMonitorOrThrow(id: string): Promise<MonitorDefinition> {
    await this.ready;
    const monitor = this.monitors.find((item) => item.id === id);
    if (!monitor) throw new AppError("Monitor Not Found", 404);
    return monitor;
  }

  start(): void {
    if (!this.enabled) return;

    void this.ready
      .then(() => {
        for (const monitor of this.monitors) {
          if (!monitor.enabled) continue;
          this.ensureScheduled(monitor);
        }
      })
      .catch((error) => {
        logger.error("monitor_init_failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }

  stop(): void {
    for (const [, timer] of this.timers) {
      clearInterval(timer);
    }
    for (const [, timer] of this.startupTimers) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.startupTimers.clear();
    this.running.clear();
  }

  private ensureScheduled(monitor: MonitorDefinition): void {
    if (this.timers.has(monitor.id)) return;
    const intervalMs = Math.max(1, monitor.scheduleMinutes) * 60 * 1000;

    const timer = setInterval(() => {
      void this.runMonitor(monitor.id, { reason: "schedule" });
    }, intervalMs);
    if (typeof timer.unref === "function") timer.unref();
    this.timers.set(monitor.id, timer);

    // Best-effort initial warm run with jitter (up to 30s).
    const jitterMs = Math.floor(Math.random() * 30_000);
    const first = setTimeout(() => {
      this.startupTimers.delete(monitor.id);
      void this.runMonitor(monitor.id, { reason: "startup" });
    }, jitterMs);
    if (typeof first.unref === "function") first.unref();
    this.startupTimers.set(monitor.id, first);
  }

  async runMonitor(
    id: string,
    opts: { reason: "startup" | "schedule" | "manual"; throwOnError?: boolean } = { reason: "manual" },
  ): Promise<void> {
    const monitor = await this.getMonitorOrThrow(id);
    if (!monitor.enabled) return;
    if (this.running.has(monitor.id)) return;
    this.running.add(monitor.id);

    const startedAt = this.nowFn();
    try {
      await this.runMonitorOnce(monitor);
      logger.info("monitor_run_ok", {
        monitorId: monitor.id,
        reason: opts.reason,
        durationMs: this.nowFn() - startedAt,
      });
    } catch (error) {
      logger.warn("monitor_run_failed", {
        monitorId: monitor.id,
        reason: opts.reason,
        durationMs: this.nowFn() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      if (opts.throwOnError) {
        throw error;
      }
    } finally {
      this.running.delete(monitor.id);
    }
  }

  private async runMonitorOnce(monitor: MonitorDefinition): Promise<void> {
    const nowMs = this.nowFn();
    const windowMs = Math.max(1, monitor.scoring.persistenceWindowHours) * 60 * 60 * 1000;
    const cutoffMs = nowMs - windowMs;

    const settledFeeds = await Promise.allSettled(
      monitor.sources.map(async (source) => {
        const query = new URLSearchParams({ limit: String(DEFAULT_QUERY_LIMIT) });
        const resp = await this.hotService.getStandardFeed(source, query);
        return { source, feed: resp.data };
      }),
    );
    const feeds: Array<{ source: SourceId; feed: Awaited<ReturnType<HotService["getStandardFeed"]>>["data"] }> = [];
    const failedSources: Array<{ source: SourceId; error: string }> = [];

    settledFeeds.forEach((result, index) => {
      const source = monitor.sources[index];
      if (!source) return;
      if (result.status === "fulfilled") {
        feeds.push(result.value);
        return;
      }
      failedSources.push({
        source,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    });

    if (failedSources.length > 0) {
      logger.warn("monitor_source_fetch_partial_failure", {
        monitorId: monitor.id,
        failedSources,
      });
    }
    if (feeds.length === 0) {
      throw new Error(`All sources failed for monitor ${monitor.id}`);
    }

    const deduped = new Map<
      string,
      {
        title: string;
        url?: string;
        mobileUrl?: string;
        desc?: string;
        sources: Set<SourceId>;
        matchReason: Set<string>;
      }
    >();

    for (const { source, feed } of feeds) {
      for (const item of feed.items) {
        const { ok, reason } = matchItem(monitor.rule, { title: item.title, desc: item.desc });
        if (!ok) continue;

        const key = buildTopicKey({ url: item.url, title: item.title });
        const existing = deduped.get(key);
        if (!existing) {
          deduped.set(key, {
            title: item.title,
            url: item.url,
            mobileUrl: item.mobileUrl,
            desc: item.desc,
            sources: new Set([source]),
            matchReason: new Set(reason),
          });
        } else {
          existing.sources.add(source);
          for (const r of reason) existing.matchReason.add(r);
          if (!existing.url && item.url) existing.url = item.url;
          if (!existing.mobileUrl && item.mobileUrl) existing.mobileUrl = item.mobileUrl;
          if (!existing.desc && item.desc) existing.desc = item.desc;
        }
      }
    }

    const nowIso = new Date(nowMs).toISOString();
    for (const [key, next] of deduped) {
      const prev = this.stateStore.getTopic(monitor.id, key);
      const occurrences = pruneSortedOccurrences([...(prev?.occurrences ?? []), nowMs].sort((a, b) => a - b), cutoffMs);

      const record: TopicStateRecord = {
        monitorId: monitor.id,
        key,
        title: next.title,
        url: next.url,
        mobileUrl: next.mobileUrl,
        desc: next.desc,
        sources: Array.from(new Set([...(prev?.sources ?? []), ...next.sources])),
        firstSeenAt: prev?.firstSeenAt ?? nowIso,
        lastSeenAt: nowIso,
        seenCount: (prev?.seenCount ?? 0) + 1,
        occurrences,
        matchReason: Array.from(new Set([...(prev?.matchReason ?? []), ...next.matchReason])),
      };

      this.stateStore.upsertTopic(record);
    }

    await this.stateStore.save();
  }

  async listTopics(
    id: string,
    options: { limit: number; refresh?: boolean; minLast24hSeenCount?: number },
  ): Promise<MonitorTopic[]> {
    const monitor = await this.getMonitorOrThrow(id);
    if (options.refresh) {
      await this.runMonitor(monitor.id, { reason: "manual", throwOnError: true });
    }

    const nowMs = this.nowFn();
    const windowMs = Math.max(1, monitor.scoring.persistenceWindowHours) * 60 * 60 * 1000;
    const cutoffMs = nowMs - windowMs;
    const halfLifeMs = Math.max(1, monitor.scoring.freshnessHalfLifeMinutes) * 60 * 1000;
    const minCount = Math.max(1, options.minLast24hSeenCount ?? monitor.scoring.persistenceThreshold);

    const topics = this.stateStore
      .listTopics(monitor.id)
      .map((record) => {
        const pruned = pruneSortedOccurrences(record.occurrences ?? [], cutoffMs);
        const last24hSeenCount = pruned.length;
        const ageMs = nowMs - Date.parse(record.lastSeenAt);
        const score =
          computePersistenceScore(last24hSeenCount) +
          computeFreshnessScore(ageMs, halfLifeMs);

        const sourceIds = (record.sources ?? []).filter((s): s is SourceId => SOURCE_MAP.has(s));

        return {
          monitorId: monitor.id,
          key: record.key,
          title: record.title,
          url: record.url,
          mobileUrl: record.mobileUrl,
          desc: record.desc,
          sources: sourceIds,
          firstSeenAt: record.firstSeenAt,
          lastSeenAt: record.lastSeenAt,
          seenCount: record.seenCount,
          last24hSeenCount,
          score,
          matchReason: record.matchReason ?? [],
        } satisfies MonitorTopic;
      })
      .filter((topic) => topic.last24hSeenCount >= minCount)
      .sort((a, b) => b.score - a.score);

    return topics.slice(0, Math.max(1, options.limit));
  }

  async buildRss(id: string, requestUrl: string, options: { limit: number; refresh?: boolean; minCount?: number }): Promise<string> {
    const monitor = await this.getMonitorOrThrow(id);
    const topics = await this.listTopics(monitor.id, {
      limit: options.limit,
      refresh: options.refresh,
      minLast24hSeenCount: Math.max(1, options.minCount ?? monitor.scoring.persistenceThreshold),
    });

    return buildRssXml({
      title: `监测：${monitor.name}`,
      link: requestUrl,
      description: `热榜监测（选题库）：${monitor.name}`,
      items: topics.map((topic) => {
        const sourceTitles = topic.sources.map((source) => SOURCE_MAP.get(source)?.title ?? source).join(" / ");
        const desc = [
          `score=${topic.score.toFixed(3)}`,
          `last24hSeenCount=${topic.last24hSeenCount}`,
          sourceTitles ? `sources=${sourceTitles}` : "",
          topic.matchReason.length > 0 ? `match=${topic.matchReason.join(",")}` : "",
          topic.desc ? `\n\n${topic.desc}` : "",
        ]
          .filter(Boolean)
          .join(" ");

        const link =
          topic.url?.trim() ||
          topic.mobileUrl?.trim() ||
          `${requestUrl}#${encodeURIComponent(topic.key)}`;

        return {
          title: topic.title,
          link,
          description: desc,
          pubDate: topic.lastSeenAt,
        };
      }),
    });
  }
}
