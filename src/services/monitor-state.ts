import fs from "node:fs/promises";
import path from "node:path";
import type { SourceId } from "../domain/sources.js";
import type { MonitorId } from "../types/monitor.js";

export interface TopicStateRecord {
  monitorId: MonitorId;
  key: string;
  title: string;
  url?: string;
  mobileUrl?: string;
  desc?: string;
  sources: SourceId[];
  firstSeenAt: string;
  lastSeenAt: string;
  seenCount: number;
  occurrences: number[];
  matchReason: string[];
}

export interface MonitorStateStore {
  load(): Promise<void>;
  listTopics(monitorId: MonitorId): TopicStateRecord[];
  getTopic(monitorId: MonitorId, key: string): TopicStateRecord | undefined;
  upsertTopic(record: TopicStateRecord): void;
  save(): Promise<void>;
}

function compoundKey(monitorId: MonitorId, key: string): string {
  return `${monitorId}::${key}`;
}

export class InMemoryMonitorStateStore implements MonitorStateStore {
  protected readonly topics = new Map<string, TopicStateRecord>();

  async load(): Promise<void> {}

  listTopics(monitorId: MonitorId): TopicStateRecord[] {
    const prefix = `${monitorId}::`;
    return Array.from(this.topics.entries())
      .filter(([key]) => key.startsWith(prefix))
      .map(([, value]) => value);
  }

  getTopic(monitorId: MonitorId, key: string): TopicStateRecord | undefined {
    return this.topics.get(compoundKey(monitorId, key));
  }

  upsertTopic(record: TopicStateRecord): void {
    this.topics.set(compoundKey(record.monitorId, record.key), record);
  }

  async save(): Promise<void> {}
}

interface StateFileShapeV1 {
  version: 1;
  updatedAt: string;
  topics: TopicStateRecord[];
}

export class FileBackedMonitorStateStore extends InMemoryMonitorStateStore {
  private readonly statePath: string;
  private readonly tmpPath: string;

  constructor(statePath: string) {
    super();
    const absolute = path.isAbsolute(statePath) ? statePath : path.resolve(process.cwd(), statePath);
    this.statePath = absolute;
    this.tmpPath = `${absolute}.tmp`;
  }

  override async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.statePath, "utf8");
      const parsed = JSON.parse(raw) as StateFileShapeV1 | { topics?: TopicStateRecord[] } | unknown;
      const topics = (parsed as StateFileShapeV1)?.topics;
      if (!Array.isArray(topics)) return;
      for (const item of topics) {
        if (!item || typeof item !== "object") continue;
        const record = item as TopicStateRecord;
        if (!record.monitorId || !record.key) continue;
        this.upsertTopic(record);
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (code === "ENOENT") return;
      throw error;
    }
  }

  override async save(): Promise<void> {
    await fs.mkdir(path.dirname(this.statePath), { recursive: true });
    const payload: StateFileShapeV1 = {
      version: 1,
      updatedAt: new Date().toISOString(),
      topics: Array.from(this.topics.values()),
    };
    await fs.writeFile(this.tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await fs.rename(this.tmpPath, this.statePath);
  }
}

