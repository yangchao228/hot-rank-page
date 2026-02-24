import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseNumber, requestJson as requestJsonShared, toIso } from "./http.js";

const execFileAsync = promisify(execFile);

const DOUYIN_ENDPOINTS = [
  "https://www.iesdouyin.com/web/api/v2/hotsearch/billboard/word/",
  "https://api.iesdouyin.com/web/api/v2/hotsearch/billboard/word/",
  "https://www.douyin.com/aweme/v1/web/hot/search/list/?device_platform=webapp&aid=6383&channel=channel_pc_web&detail_list=1",
] as const;

interface DouyinWordItem {
  sentence_id?: string | number;
  position?: number;
  word?: string;
  title?: string;
  hot_value?: number;
  hotValue?: number;
  event_time?: string | number;
  timestamp?: string | number;
  label?: string | number;
}

interface DouyinPayloadShape {
  word_list?: DouyinWordItem[];
  data?: {
    word_list?: DouyinWordItem[];
  };
  active_time?: string;
}

interface TcslwDouyinResponse {
  success?: boolean;
  msg?: string;
  title?: string;
  subtitle?: string;
  update_time?: string;
  total?: number;
  data?: Array<Record<string, unknown>>;
}

export interface DouyinPayload {
  name: "douyin";
  title: "抖音";
  type: "热榜";
  description: string;
  link: string;
  total: number;
  data: Array<{
    id: string | number;
    title: string;
    desc?: string;
    timestamp?: string;
    hot?: number;
    url: string;
    mobileUrl: string;
  }>;
}

function normalizeIsoFromUnknown(value: unknown): string | undefined {
  if (typeof value === "number") {
    const ms = value > 946684800000 ? value : value * 1000;
    return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
  }

  if (typeof value !== "string" || value.trim() === "") {
    return undefined;
  }

  const raw = value.trim();

  if (/^\d+$/.test(raw)) {
    const n = Number.parseInt(raw, 10);
    if (Number.isNaN(n)) {
      return undefined;
    }
    const ms = n > 946684800000 ? n : n * 1000;
    return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
  }

  if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/.test(raw)) {
    const iso = raw.replace(" ", "T") + "+08:00";
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
  }

  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return new Date(parsed).toISOString();
}

function resolveWordList(json: DouyinPayloadShape): DouyinWordItem[] {
  if (Array.isArray(json.word_list)) {
    return json.word_list;
  }
  if (json.data && Array.isArray(json.data.word_list)) {
    return json.data.word_list;
  }
  return [];
}

async function requestJsonWithFetch(
  url: string,
  timeoutMs: number,
  headers: Record<string, string>,
): Promise<DouyinPayloadShape> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Douyin endpoint returned ${response.status}`);
    }

    const text = await response.text();
    if (!text.trim()) {
      throw new Error("Douyin endpoint returned empty response");
    }

    return JSON.parse(text) as DouyinPayloadShape;
  } finally {
    clearTimeout(timer);
  }
}

async function requestJsonWithCurl(
  url: string,
  timeoutMs: number,
  headers: Record<string, string>,
): Promise<DouyinPayloadShape> {
  const args = ["-sL", "--max-time", String(Math.ceil(timeoutMs / 1000)), url];
  for (const [key, value] of Object.entries(headers)) {
    args.push("-H", `${key}: ${value}`);
  }

  const { stdout } = await execFileAsync("curl", args, { maxBuffer: 5 * 1024 * 1024 });
  if (!stdout.trim()) {
    throw new Error("Douyin curl fallback returned empty response");
  }

  return JSON.parse(stdout) as DouyinPayloadShape;
}

async function requestJson(url: string, timeoutMs: number): Promise<DouyinPayloadShape> {
  const headers: Record<string, string> = {
    accept: "application/json, text/plain, */*",
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    referer: "https://www.douyin.com/hot",
  };

  try {
    return await requestJsonWithFetch(url, timeoutMs, headers);
  } catch {
    return requestJsonWithCurl(url, timeoutMs, headers);
  }
}

async function fetchTcslwDouyinHotList(timeoutMs: number): Promise<DouyinPayload | null> {
  const json = await requestJsonShared<TcslwDouyinResponse>("https://api.tcslw.cn/api/hotlist?type=douyin", {
    timeoutMs,
    headers: {
      accept: "application/json, text/plain, */*",
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      referer: "https://api.tcslw.cn/",
    },
    maxBufferBytes: 8 * 1024 * 1024,
  });

  const rows = Array.isArray(json.data) ? json.data : [];
  if (rows.length === 0) {
    return null;
  }

  const fallbackTime = toIso(json.update_time) ?? normalizeIsoFromUnknown(json.update_time);
  const data = rows
    .map((row, index) => {
      const title = typeof row.title === "string" ? row.title.trim() : "";
      if (!title) return null;
      const url =
        (typeof row.url === "string" && row.url.trim() ? row.url.trim() : undefined) ??
        `https://www.douyin.com/search/${encodeURIComponent(title)}`;
      return {
        id:
          typeof row.id === "string" || typeof row.id === "number"
            ? row.id
            : typeof row.index === "number" || typeof row.index === "string"
              ? row.index
              : index + 1,
        title,
        desc: typeof row.subtitle === "string" ? row.subtitle.trim() : undefined,
        timestamp: toIso(row.update_time) ?? normalizeIsoFromUnknown(row.time) ?? fallbackTime,
        hot: parseNumber(row.hot),
        url,
        mobileUrl:
          (typeof row.mobilUrl === "string" && row.mobilUrl.trim() ? row.mobilUrl.trim() : undefined) ?? url,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  if (data.length === 0) {
    return null;
  }

  return {
    name: "douyin",
    title: "抖音",
    type: "热榜",
    description: "抖音热榜",
    link: "https://www.douyin.com/hot",
    total: data.length,
    data,
  };
}

export async function fetchDouyinHotList(timeoutMs: number): Promise<DouyinPayload> {
  let lastError: unknown;

  try {
    const mirrorPayload = await fetchTcslwDouyinHotList(Math.max(2500, Math.floor(timeoutMs / 2)));
    if (mirrorPayload) {
      return mirrorPayload;
    }
    lastError = new Error("tcslw douyin mirror returned empty data");
  } catch (error) {
    lastError = error;
  }

  const perEndpointTimeout = Math.max(2500, Math.floor(timeoutMs / DOUYIN_ENDPOINTS.length));

  for (const endpoint of DOUYIN_ENDPOINTS) {
    try {
      const json = await requestJson(endpoint, perEndpointTimeout);
      const list = resolveWordList(json);
      if (!Array.isArray(list) || list.length === 0) {
        continue;
      }

      const fallbackTime = normalizeIsoFromUnknown(json.active_time);
      const data = list
        .map((item, index) => {
          const title = (item.word ?? item.title ?? "").trim();
          if (!title) {
            return null;
          }

          const id = item.sentence_id ?? item.position ?? index + 1;
          const url =
            typeof item.sentence_id === "number" || typeof item.sentence_id === "string"
              ? `https://www.douyin.com/hot/${String(item.sentence_id)}`
              : `https://www.douyin.com/search/${encodeURIComponent(title)}`;

          return {
            id,
            title,
            desc: item.label === undefined ? undefined : `标签 ${String(item.label)}`,
            timestamp: normalizeIsoFromUnknown(item.event_time ?? item.timestamp) ?? fallbackTime,
            hot: item.hot_value ?? item.hotValue,
            url,
            mobileUrl: url,
          };
        })
        .filter((value): value is NonNullable<typeof value> => value !== null);

      if (data.length === 0) {
        continue;
      }

      return {
        name: "douyin",
        title: "抖音",
        type: "热榜",
        description: "抖音热榜",
        link: "https://www.douyin.com/hot",
        total: data.length,
        data,
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Failed to fetch douyin hot list");
}
