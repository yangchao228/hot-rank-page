import type { SourceId } from "../domain/sources.js";

export type MonitorId = string;

export interface MonitorRule {
  includeKeywords: string[];
  excludeKeywords: string[];
  includeRegex?: string;
  excludeRegex?: string;
  fields?: Array<"title" | "desc">;
}

export interface MonitorRssOutput {
  enabled: boolean;
  topN: number;
}

export interface MonitorOutputs {
  rss: MonitorRssOutput;
}

export interface MonitorScoringConfig {
  persistenceWindowHours: number;
  persistenceThreshold: number;
  freshnessHalfLifeMinutes: number;
}

export interface MonitorDefinition {
  id: MonitorId;
  name: string;
  enabled: boolean;
  sources: SourceId[];
  scheduleMinutes: number;
  rule: MonitorRule;
  scoring: MonitorScoringConfig;
  outputs: MonitorOutputs;
}

export interface MonitorTopic {
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
  last24hSeenCount: number;
  score: number;
  matchReason: string[];
}

