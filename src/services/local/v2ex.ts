import { ensureAbsoluteUrl, requestJson, requestText, toIso } from './http.js';

interface V2exTopic {
  id?: number;
  title?: string;
  url?: string;
  created?: number;
  last_modified?: number;
  replies?: number;
  member?: { username?: string };
  node?: { title?: string };
}

export interface V2exPayload {
  name: 'v2ex';
  title: 'V2EX';
  type: '主题榜';
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

function stripHtml(input: string): string {
  return input
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function parseV2exHtml(html: string): V2exPayload | null {
  const itemRegex = /<div\s+class=["']cell item["'][\s\S]*?<\/div>\s*<\/div>/gi;
  const topicRegex = /<a[^>]+class=["']topic-link["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i;
  const countRegex = /<a[^>]+class=["']count_livid["'][^>]*>(\d+)<\/a>/i;
  const nodeRegex = /<a[^>]+class=["']node["'][^>]*>([\s\S]*?)<\/a>/i;
  const memberRegex = /<strong><a[^>]*>([\s\S]*?)<\/a><\/strong>/i;

  const data: V2exPayload["data"] = [];
  const seen = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = itemRegex.exec(html))) {
    const block = match[0];
    if (!block) continue;
    const topic = block.match(topicRegex);
    const route = topic?.[1] ? String(topic[1]) : "";
    const title = topic?.[2] ? stripHtml(String(topic[2])) : "";
    if (!route || !title) continue;
    if (seen.has(route)) continue;
    seen.add(route);

    const url = ensureAbsoluteUrl(route, "https://www.v2ex.com");
    if (!url) continue;
    const countMatch = block.match(countRegex);
    const nodeMatch = block.match(nodeRegex);
    const memberMatch = block.match(memberRegex);
    const replies =
      countMatch?.[1] && !Number.isNaN(Number.parseInt(countMatch[1], 10))
        ? Number.parseInt(countMatch[1], 10)
        : undefined;
    const descParts = [
      nodeMatch?.[1] ? stripHtml(String(nodeMatch[1])) : undefined,
      memberMatch?.[1] ? `@${stripHtml(String(memberMatch[1]))}` : undefined,
    ].filter(Boolean);

    const idMatch = route.match(/\/t\/(\d+)/);
    data.push({
      id: idMatch?.[1] ?? `v2ex-${data.length + 1}`,
      title,
      desc: descParts.length > 0 ? descParts.join(" · ") : undefined,
      hot: replies,
      timestamp: undefined,
      url,
      mobileUrl: url,
    });
    if (data.length >= 50) break;
  }

  if (data.length === 0) return null;
  return {
    name: "v2ex",
    title: "V2EX",
    type: "主题榜",
    description: "V2EX 热门主题",
    link: "https://www.v2ex.com/?tab=hot",
    total: data.length,
    data,
  };
}

function parseV2exRss(xml: string): V2exPayload | null {
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  const readTag = (block: string, name: string) => {
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

  const data: V2exPayload["data"] = [];
  let match: RegExpExecArray | null;
  while ((match = itemRegex.exec(xml))) {
    const block = match[1] ?? "";
    const title = stripHtml(decode(readTag(block, "title")));
    const link = decode(readTag(block, "link"));
    const description = stripHtml(decode(readTag(block, "description")));
    const pubDate = decode(readTag(block, "pubDate"));
    if (!title || !link) continue;
    const url = ensureAbsoluteUrl(link, "https://www.v2ex.com");
    if (!url) continue;
    const idMatch = url.match(/\/t\/(\d+)/);
    data.push({
      id: idMatch?.[1] ?? `v2ex-rss-${data.length + 1}`,
      title,
      desc: description || undefined,
      timestamp: toIso(pubDate),
      url,
      mobileUrl: url,
    });
    if (data.length >= 50) break;
  }

  if (data.length === 0) return null;
  return {
    name: "v2ex",
    title: "V2EX",
    type: "主题榜",
    description: "V2EX 热门主题",
    link: "https://www.v2ex.com/?tab=hot",
    total: data.length,
    data,
  };
}

function getOptionalMirrorBaseUrl(): string | null {
  const raw = process.env.V2EX_MIRROR_BASE_URL?.trim();
  if (!raw) {
    return null;
  }
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export async function fetchV2exHotList(timeoutMs: number): Promise<V2exPayload> {
  const headers = {
    accept: "application/json, text/plain, */*",
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    referer: "https://www.v2ex.com/?tab=hot",
  } as const;

  const mirrorBase = getOptionalMirrorBaseUrl();
  const apiCandidates = [
    "https://www.v2ex.com/api/topics/hot.json",
    "https://v2ex.com/api/topics/hot.json",
    "https://www.v2ex.com/api/topics/latest.json",
  ] as const;
  const mirrorApiCandidates = mirrorBase
    ? [
        `${mirrorBase}/api/topics/hot.json`,
        `${mirrorBase}/api/topics/latest.json`,
      ]
    : [];
  const htmlCandidates = ["https://www.v2ex.com/?tab=hot", "https://v2ex.com/?tab=hot"] as const;
  const mirrorHtmlCandidates = mirrorBase ? [`${mirrorBase}/?tab=hot`] : [];
  const rssCandidates = ["https://www.v2ex.com/index.xml", "https://v2ex.com/index.xml"] as const;
  const mirrorRssCandidates = mirrorBase ? [`${mirrorBase}/index.xml`] : [];
  // requestText/requestJson may try fetch then curl, so divide budget again to cap worst-case latency.
  const totalAttempts =
    apiCandidates.length +
    mirrorApiCandidates.length +
    htmlCandidates.length +
    mirrorHtmlCandidates.length +
    rssCandidates.length +
    mirrorRssCandidates.length;
  const perStepTimeout = Math.max(600, Math.floor(timeoutMs / Math.max(1, totalAttempts * 2)));

  let lastError: unknown;

  for (const apiUrl of [...apiCandidates, ...mirrorApiCandidates]) {
    try {
      const rows = await requestJson<V2exTopic[]>(apiUrl, {
        timeoutMs: perStepTimeout,
        headers,
        maxBufferBytes: 5 * 1024 * 1024,
      });

      const list = Array.isArray(rows) ? rows : [];
      const data = list
        .map((row, index) => {
          const title = typeof row.title === "string" ? row.title.trim() : "";
          if (!title) return null;
          const url =
            ensureAbsoluteUrl(row.url, "https://www.v2ex.com") ?? "https://www.v2ex.com/?tab=hot";
          const descParts = [
            row.node?.title,
            row.member?.username ? `@${row.member.username}` : undefined,
          ].filter(Boolean);
          return {
            id: String(row.id ?? index + 1),
            title,
            desc: descParts.length > 0 ? descParts.join(" · ") : undefined,
            hot: typeof row.replies === "number" ? row.replies : undefined,
            timestamp: toIso(row.last_modified ?? row.created),
            url,
            mobileUrl: url,
          };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null);

      if (data.length > 0) {
        return {
          name: "v2ex",
          title: "V2EX",
          type: "主题榜",
          description: "V2EX 热门主题",
          link: "https://www.v2ex.com/?tab=hot",
          total: data.length,
          data,
        };
      }
    } catch (error) {
      lastError = error;
    }
  }

  try {
    for (const htmlUrl of [...htmlCandidates, ...mirrorHtmlCandidates]) {
      try {
        const html = await requestText(htmlUrl, {
          timeoutMs: perStepTimeout,
          headers: {
            accept: "text/html,application/xhtml+xml",
            "user-agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          },
          maxBufferBytes: 5 * 1024 * 1024,
        });
        const parsed = parseV2exHtml(html);
        if (parsed) {
          return parsed;
        }
      } catch (error) {
        lastError = error;
      }
    }
  } catch (error) {
    lastError = error;
  }

  for (const rssUrl of [...rssCandidates, ...mirrorRssCandidates]) {
    try {
      const xml = await requestText(rssUrl, {
        timeoutMs: perStepTimeout,
        headers: {
          accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        },
        maxBufferBytes: 5 * 1024 * 1024,
      });
      const parsed = parseV2exRss(xml);
      if (parsed) {
        return parsed;
      }
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Failed to fetch v2ex hot list");
}
