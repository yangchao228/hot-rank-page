import { ensureAbsoluteUrl, parseNumber, requestText, toIso } from './http.js';

interface Kr36Payload {
  name: '36kr';
  title: '36 氪';
  type: '热榜';
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

function stripTags(input: string): string {
  return input
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function extractScriptJsonById(html: string, id: string): string | null {
  const match = html.match(new RegExp(`<script[^>]+id=["']${id}["'][^>]*>([\\s\\S]*?)<\\/script>`, 'i'));
  return match?.[1]?.trim() ?? null;
}

function extractAssignedJson(html: string, marker: string): string | null {
  const index = html.indexOf(marker);
  if (index < 0) return null;
  let start = index + marker.length;
  while (start < html.length && html[start] !== '{') start += 1;
  if (start >= html.length) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i += 1) {
    const ch = html[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  return null;
}

function collectCandidates(node: unknown, bucket: Array<Record<string, unknown>>): void {
  if (Array.isArray(node)) {
    for (const item of node) collectCandidates(item, bucket);
    return;
  }
  if (!node || typeof node !== 'object') return;
  const record = node as Record<string, unknown>;

  const titleFields = [record.title, record.articleTitle, record.widgetTitle, record.name, (record.templateMaterial as Record<string, unknown> | undefined)?.widgetTitle];
  const title = titleFields.find((v) => typeof v === 'string' && (v as string).trim().length > 3);
  const possibleUrl = [
    record.url,
    record.route,
    record.jumpUrl,
    record.itemJumpUrl,
    (record.templateMaterial as Record<string, unknown> | undefined)?.jumpUrl,
    (record.templateMaterial as Record<string, unknown> | undefined)?.itemJumpUrl,
  ].find((v) => typeof v === 'string' && (v as string).trim());
  const itemId = record.itemId ?? record.id ?? (record.templateMaterial as Record<string, unknown> | undefined)?.itemId;

  if (typeof title === 'string' && (possibleUrl || itemId)) {
    bucket.push({
      id: itemId,
      title: title.trim(),
      url: possibleUrl,
      desc: record.summary ?? record.description ?? (record.templateMaterial as Record<string, unknown> | undefined)?.summary,
      hot: record.hotScore ?? record.hot_score ?? record.viewCount ?? record.statRead ?? (record.templateMaterial as Record<string, unknown> | undefined)?.hotScore,
      timestamp:
        record.publishTime ??
        record.publish_time ??
        record.templateMaterialPublishTime ??
        (record.templateMaterial as Record<string, unknown> | undefined)?.publishTime,
    });
  }

  for (const value of Object.values(record)) {
    collectCandidates(value, bucket);
  }
}

function parseFromJsonBlob(value: unknown): Kr36Payload | null {
  const bucket: Array<Record<string, unknown>> = [];
  collectCandidates(value, bucket);

  const dedup = new Map<string, Kr36Payload['data'][number]>();
  for (let i = 0; i < bucket.length; i += 1) {
    const row = bucket[i] ?? {};
    const title = typeof row.title === 'string' ? row.title.trim() : '';
    if (!title || title.length < 4) continue;
    if (/^(HTTP Status|Exception Report|Please enable)/i.test(title)) continue;
    const itemId = row.id;
    const route = typeof row.url === 'string' ? row.url : undefined;
    const url =
      ensureAbsoluteUrl(route, 'https://www.36kr.com') ??
      ((typeof itemId === 'string' || typeof itemId === 'number') ? `https://www.36kr.com/p/${String(itemId)}` : undefined);
    if (!url) continue;
    const key = `${title}|${url}`;
    if (dedup.has(key)) continue;
    dedup.set(key, {
      id: (typeof itemId === 'string' || typeof itemId === 'number') ? String(itemId) : `36kr-${dedup.size + 1}`,
      title,
      desc: typeof row.desc === 'string' ? stripTags(row.desc).slice(0, 120) || undefined : undefined,
      hot: parseNumber(row.hot),
      timestamp: toIso(row.timestamp),
      url,
      mobileUrl: url,
    });
    if (dedup.size >= 50) break;
  }

  const data = Array.from(dedup.values());
  if (data.length === 0) return null;
  return {
    name: '36kr',
    title: '36 氪',
    type: '热榜',
    description: '36kr 热门资讯',
    link: 'https://www.36kr.com/hot-list/catalog',
    total: data.length,
    data,
  };
}

function parseFromHtmlLinks(html: string): Kr36Payload | null {
  const regex =
    /<a[^>]+href=["']((?:https?:\/\/(?:www\.)?36kr\.com)?\/(?:p\/\d+|newsflashes\/\d+|video\/\d+)[^"']*)["'][^>]*?(?:title=["']([^"']+)["'])?[^>]*>([\s\S]*?)<\/a>/gi;
  const dedup = new Map<string, Kr36Payload['data'][number]>();
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html))) {
    const route = match[1] ?? "";
    const titleAttr = match[2] ?? "";
    const inner = match[3] ?? "";
    const title = stripTags(titleAttr || inner);
    if (!route || !title || title.length < 4) continue;
    if (dedup.has(route)) continue;
    const url = ensureAbsoluteUrl(route, 'https://www.36kr.com');
    if (!url) continue;
    dedup.set(route, {
      id: route.replace(/\D+/g, '') || `36kr-${dedup.size + 1}`,
      title,
      url,
      mobileUrl: url,
    });
    if (dedup.size >= 50) break;
  }
  const data = Array.from(dedup.values());
  if (data.length === 0) return null;
  return {
    name: '36kr',
    title: '36 氪',
    type: '热榜',
    description: '36kr 热门资讯',
    link: 'https://www.36kr.com/hot-list/catalog',
    total: data.length,
    data,
  };
}

function parseRss(xml: string): Kr36Payload | null {
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  const tag = (block: string, name: string) => {
    const m = block.match(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`, "i"));
    return m?.[1]?.trim() ?? "";
  };

  const decode = (input: string) =>
    input
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");

  const data: Kr36Payload["data"] = [];
  let match: RegExpExecArray | null;
  while ((match = itemRegex.exec(xml))) {
    const block = match[1] ?? "";
    const title = stripTags(decode(tag(block, "title")));
    const link = decode(tag(block, "link"));
    if (!title || !link) continue;
    const url = ensureAbsoluteUrl(link, "https://www.36kr.com");
    if (!url) continue;
    const descRaw = decode(tag(block, "description"));
    const pubDate = decode(tag(block, "pubDate"));
    const guid = decode(tag(block, "guid"));
    data.push({
      id: guid || String(data.length + 1),
      title,
      desc: stripTags(descRaw).slice(0, 140) || undefined,
      timestamp: toIso(pubDate),
      url,
      mobileUrl: url,
    });
    if (data.length >= 50) break;
  }

  if (data.length === 0) return null;
  return {
    name: "36kr",
    title: "36 氪",
    type: "热榜",
    description: "36kr 热门资讯",
    link: "https://www.36kr.com/hot-list/catalog",
    total: data.length,
    data,
  };
}

export async function fetch36KrHotList(timeoutMs: number): Promise<Kr36Payload> {
  const pageCandidates = [
    "https://www.36kr.com/hot-list/catalog",
    "https://36kr.com/hot-list/catalog",
    "https://www.36kr.com/information/web_news/",
    "https://36kr.com/information/web_news/",
  ];
  let lastError: unknown;

  for (const url of pageCandidates) {
    try {
      const html = await requestText(url, {
        timeoutMs,
        headers: {
          accept: 'text/html,application/xhtml+xml',
          'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          referer: 'https://www.36kr.com/',
        },
        maxBufferBytes: 10 * 1024 * 1024,
      });

      const blobs = [
        extractScriptJsonById(html, '__NEXT_DATA__'),
        extractAssignedJson(html, 'window.__INITIAL_STATE__='),
        extractAssignedJson(html, 'window.__NUXT__='),
      ].filter((v): v is string => Boolean(v));

      for (const blob of blobs) {
        try {
          const parsed = JSON.parse(blob) as unknown;
          const payload = parseFromJsonBlob(parsed);
          if (payload) return payload;
        } catch {
          // continue to next blob
        }
      }

      const linkPayload = parseFromHtmlLinks(html);
      if (linkPayload) return linkPayload;
      lastError = new Error('36kr page parsed but no hot list items found');
    } catch (error) {
      lastError = error;
    }
  }

  const rssCandidates = ["https://36kr.com/feed", "https://www.36kr.com/feed"];
  for (const url of rssCandidates) {
    try {
      const xml = await requestText(url, {
        timeoutMs,
        headers: {
          accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        },
        maxBufferBytes: 5 * 1024 * 1024,
      });
      const rssPayload = parseRss(xml);
      if (rssPayload) return rssPayload;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Failed to fetch 36kr hot list');
}
