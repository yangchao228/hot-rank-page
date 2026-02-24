import { requestJson, toIso } from './http.js';

interface BilibiliRankingResponse {
  code?: number;
  message?: string;
  data?: {
    list?: Array<Record<string, unknown>>;
    items?: Array<Record<string, unknown>>;
  };
  result?: Array<Record<string, unknown>>;
}

export interface BilibiliPayload {
  name: 'bilibili';
  title: '哔哩哔哩';
  type: '热门榜';
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

function getOptionalBilibiliMirrorApiUrl(): string | null {
  const raw = process.env.BILIBILI_MIRROR_API_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeRows(rows: Array<Record<string, unknown>>): BilibiliPayload["data"] {
  return rows
    .map((row, index) => {
      const title = typeof row.title === 'string' ? row.title.trim() : '';
      if (!title) return null;
      const bvid = typeof row.bvid === 'string' ? row.bvid : undefined;
      const aid = typeof row.aid === 'number' || typeof row.aid === 'string' ? String(row.aid) : undefined;
      const url = bvid ? `https://www.bilibili.com/video/${bvid}` : aid ? `https://www.bilibili.com/video/av${aid}` : 'https://www.bilibili.com/';
      const owner = (row.owner ?? {}) as Record<string, unknown>;
      const stat = (row.stat ?? row.stats ?? {}) as Record<string, unknown>;
      return {
        id: bvid ?? aid ?? `bilibili-${index + 1}`,
        title,
        desc:
          typeof owner.name === 'string'
            ? `UP主 ${owner.name}`
            : typeof row.desc === "string"
              ? row.desc.slice(0, 80)
              : undefined,
        hot: typeof stat.view === 'number' ? stat.view : undefined,
        timestamp: toIso(row.pubdate ?? row.ctime ?? row.pub_time ?? row.duration),
        url,
        mobileUrl: url,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
}

function extractBilibiliRows(json: BilibiliRankingResponse): Array<Record<string, unknown>> {
  if (Array.isArray(json.data?.list)) return json.data.list;
  if (Array.isArray(json.data?.items)) return json.data.items;
  if (Array.isArray(json.result)) return json.result;
  return [];
}

export async function fetchBilibiliHotList(timeoutMs: number): Promise<BilibiliPayload> {
  const headers = {
    accept: 'application/json, text/plain, */*',
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    referer: 'https://www.bilibili.com/',
  } as const;
  const mirrorApi = getOptionalBilibiliMirrorApiUrl();
  const candidates = [
    'https://api.bilibili.com/x/web-interface/ranking/v2?rid=0&type=all',
    'https://api.bilibili.com/x/web-interface/popular?ps=50&pn=1',
    'https://app.bilibili.com/x/v2/search/trending/ranking?limit=50',
    ...(mirrorApi ? [mirrorApi] : []),
  ];
  const perTimeout = Math.max(700, Math.floor(timeoutMs / Math.max(1, candidates.length * 2)));
  let lastError: unknown;
  let data: BilibiliPayload["data"] = [];

  for (const url of candidates) {
    try {
      const json = await requestJson<BilibiliRankingResponse>(url, {
        timeoutMs: perTimeout,
        headers,
        maxBufferBytes: 8 * 1024 * 1024,
      });
      if (typeof json.code === "number" && json.code !== 0) {
        throw new Error(`Bilibili api code ${json.code}${json.message ? `: ${json.message}` : ""}`);
      }
      data = normalizeRows(extractBilibiliRows(json));
      if (data.length > 0) {
        break;
      }
      lastError = new Error("Bilibili api returned empty rows");
    } catch (error) {
      lastError = error;
    }
  }

  if (data.length === 0) {
    throw (lastError instanceof Error ? lastError : new Error('Bilibili ranking returned empty data'));
  }

  return {
    name: 'bilibili',
    title: '哔哩哔哩',
    type: '热门榜',
    description: 'B 站热门内容',
    link: 'https://www.bilibili.com/v/popular/all',
    total: data.length,
    data,
  };
}
