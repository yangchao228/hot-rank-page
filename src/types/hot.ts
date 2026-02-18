export interface HotItem {
  id: string;
  title: string;
  url?: string;
  mobileUrl?: string;
  desc?: string;
  hot?: string | number;
  timestamp?: string;
  source: string;
  raw: unknown;
}

export interface HotFeed {
  source: string;
  title: string;
  type?: string;
  link?: string;
  total: number;
  fromCache: boolean;
  updateTime: string;
  items: HotItem[];
}

export interface AggregateHotData {
  sources: string[];
  total: number;
  updateTime: string;
  failedSources: string[];
  items: HotItem[];
}

export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

export interface CompatRoute {
  name: string;
  path: string;
  title: string;
  type: string;
}

export interface UpstreamHotPayload {
  name?: string;
  title?: string;
  type?: string;
  link?: string;
  total?: number;
  fromCache?: boolean;
  updateTime?: string;
  data?: unknown[];
  [key: string]: unknown;
}

export interface CachedEntry<T> {
  value: T;
  updatedAt: number;
  expiresAt: number;
  staleUntil: number;
}

export type CacheState = "miss" | "fresh" | "stale";
