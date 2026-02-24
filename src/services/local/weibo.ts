import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const WEIBO_ENDPOINTS = [
  "https://weibo.com/ajax/side/hotSearch",
  "https://m.weibo.cn/api/container/getIndex?containerid=106003type%3D25%26t%3D3%26disable_hot%3D1%26filter_type%3Drealtimehot",
] as const;

interface WeiboAjaxRealtimeItem {
  word?: string;
  note?: string;
  word_scheme?: string;
  raw_hot?: number;
  num?: number | string;
  onboard_time?: string | number;
  flag_desc?: string;
  icon_desc?: string;
  category?: string;
}

interface WeiboAjaxResponse {
  data?: {
    realtime?: WeiboAjaxRealtimeItem[];
  };
}

interface WeiboMobileCardItem {
  desc?: string;
  scheme?: string;
  desc_extr?: number | string;
  pic?: string;
  icon?: string;
  itemid?: string;
  actionlog?: {
    oid?: string | number;
  };
}

interface WeiboMobileResponse {
  ok?: number;
  data?: {
    cards?: Array<{
      card_group?: WeiboMobileCardItem[];
    }>;
  };
}

export interface WeiboPayload {
  name: "weibo";
  title: "微博";
  type: "热搜榜";
  description: string;
  link: string;
  total: number;
  data: Array<{
    id: string;
    title: string;
    desc?: string;
    hot?: number;
    timestamp?: string;
    url: string;
    mobileUrl: string;
  }>;
}

function parseHotValue(input: unknown): number | undefined {
  if (typeof input === "number") {
    return Number.isFinite(input) ? input : undefined;
  }
  if (typeof input !== "string") {
    return undefined;
  }
  const normalized = input.replace(/[,，\s]/g, "").trim();
  if (!normalized) {
    return undefined;
  }

  const unitMatch = normalized.match(/^([0-9]+(?:\.[0-9]+)?)(亿|万|千)?$/);
  if (!unitMatch) {
    const digits = Number.parseInt(normalized.replace(/\D+/g, ""), 10);
    return Number.isNaN(digits) ? undefined : digits;
  }

  const numericText = unitMatch[1];
  if (!numericText) {
    return undefined;
  }
  const value = Number.parseFloat(numericText);
  if (Number.isNaN(value)) {
    return undefined;
  }

  const unit = unitMatch[2];
  const multiplier = unit === "亿" ? 100000000 : unit === "万" ? 10000 : unit === "千" ? 1000 : 1;
  return Math.round(value * multiplier);
}

function parseWeiboTime(input: unknown): string | undefined {
  if (typeof input === "number") {
    const ms = input > 946684800000 ? input : input * 1000;
    return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
  }

  if (typeof input !== "string") {
    return undefined;
  }

  const text = input.trim();
  if (!text) {
    return undefined;
  }

  if (/^\d+$/.test(text)) {
    const n = Number.parseInt(text, 10);
    if (Number.isNaN(n)) {
      return undefined;
    }
    return new Date((n > 946684800000 ? n : n * 1000)).toISOString();
  }

  if (/^\d{2}:\d{2}$/.test(text)) {
    const now = new Date();
    const [hour, minute] = text.split(":").map((v) => Number.parseInt(v, 10));
    now.setHours(hour ?? 0, minute ?? 0, 0, 0);
    return now.toISOString();
  }

  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return new Date(parsed).toISOString();
}

function buildWeiboSearchUrl(keyword: string): string {
  return `https://s.weibo.com/weibo?q=${encodeURIComponent(keyword)}`;
}

function parseAjaxResponse(json: WeiboAjaxResponse): WeiboPayload | null {
  const rows = Array.isArray(json.data?.realtime) ? json.data.realtime : [];
  const data = rows
    .map((row, index) => {
      const title = (row.word ?? row.note ?? "").trim();
      if (!title) {
        return null;
      }

      return {
        id: `weibo-${index + 1}`,
        title,
        desc: undefined,
        hot: parseHotValue(row.raw_hot ?? row.num),
        timestamp: parseWeiboTime(row.onboard_time),
        url: buildWeiboSearchUrl(title),
        mobileUrl: buildWeiboSearchUrl(title),
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  if (data.length === 0) {
    return null;
  }

  return {
    name: "weibo",
    title: "微博",
    type: "热搜榜",
    description: "微博实时热搜",
    link: "https://s.weibo.com/top/summary",
    total: data.length,
    data,
  };
}

function parseMobileResponse(json: WeiboMobileResponse): WeiboPayload | null {
  const cards = Array.isArray(json.data?.cards) ? json.data.cards : [];
  const group = cards.flatMap((card) => (Array.isArray(card.card_group) ? card.card_group : []));

  const data = group
    .map((row, index) => {
      const title = (row.desc ?? "").trim();
      if (!title) {
        return null;
      }

      return {
        id:
          (typeof row.actionlog?.oid === "string" || typeof row.actionlog?.oid === "number"
            ? String(row.actionlog.oid)
            : undefined) ?? `weibo-${index + 1}`,
        title,
        desc: undefined,
        hot: parseHotValue(row.desc_extr),
        timestamp: undefined,
        url: buildWeiboSearchUrl(title),
        mobileUrl: buildWeiboSearchUrl(title),
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  if (data.length === 0) {
    return null;
  }

  return {
    name: "weibo",
    title: "微博",
    type: "热搜榜",
    description: "微博实时热搜",
    link: "https://s.weibo.com/top/summary",
    total: data.length,
    data,
  };
}

async function fetchTextWithFetch(
  url: string,
  timeoutMs: number,
  headers: Record<string, string>,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method: "GET", headers, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Weibo endpoint returned ${response.status}`);
    }
    const text = await response.text();
    if (!text.trim()) {
      throw new Error("Weibo endpoint returned empty response");
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTextWithCurl(
  url: string,
  timeoutMs: number,
  headers: Record<string, string>,
): Promise<string> {
  const args = ["-sL", "--max-time", String(Math.ceil(timeoutMs / 1000)), url];
  for (const [key, value] of Object.entries(headers)) {
    args.push("-H", `${key}: ${value}`);
  }
  const { stdout } = await execFileAsync("curl", args, { maxBuffer: 8 * 1024 * 1024 });
  if (!stdout.trim()) {
    throw new Error("Weibo curl fallback returned empty response");
  }
  return stdout;
}

async function requestJson(url: string, timeoutMs: number): Promise<unknown> {
  const headers: Record<string, string> = {
    accept: "application/json, text/plain, */*",
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    referer: "https://s.weibo.com/top/summary",
  };

  let text: string;
  try {
    text = await fetchTextWithFetch(url, timeoutMs, headers);
  } catch {
    text = await fetchTextWithCurl(url, timeoutMs, headers);
  }

  return JSON.parse(text) as unknown;
}

export async function fetchWeiboHotList(timeoutMs: number): Promise<WeiboPayload> {
  const perEndpointTimeout = Math.max(2500, Math.floor(timeoutMs / WEIBO_ENDPOINTS.length));
  let lastError: unknown;

  for (const endpoint of WEIBO_ENDPOINTS) {
    try {
      const json = await requestJson(endpoint, perEndpointTimeout);
      const payload = endpoint.includes("ajax/side/hotSearch")
        ? parseAjaxResponse(json as WeiboAjaxResponse)
        : parseMobileResponse(json as WeiboMobileResponse);

      if (payload && payload.data.length > 0) {
        return payload;
      }
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Failed to fetch weibo hot list");
}
