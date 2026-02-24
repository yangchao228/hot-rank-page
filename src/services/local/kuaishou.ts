import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

interface KuaishouPayload {
  name: "kuaishou";
  title: "快手";
  type: "热榜";
  description: string;
  link: string;
  total: number;
  data: Array<{
    id: string;
    title: string;
    cover?: string;
    timestamp?: string;
    hot?: number;
    url: string;
    mobileUrl: string;
  }>;
}

interface MirrorJsonPayload {
  data?: Array<Record<string, unknown>>;
  items?: Array<Record<string, unknown>>;
}

function getOptionalKuaishouMirrorUrl(): string | null {
  const raw = process.env.KUAISHOU_MIRROR_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function parseChineseNumber(input: string | undefined): number | undefined {
  if (!input) {
    return undefined;
  }
  const text = input.trim();
  if (!text) {
    return undefined;
  }

  const unitMap: Record<string, number> = {
    亿: 100000000,
    万: 10000,
    千: 1000,
    百: 100,
  };

  for (const [unit, multiplier] of Object.entries(unitMap)) {
    if (text.includes(unit)) {
      const numberPart = Number.parseFloat(text.replace(unit, ""));
      if (Number.isNaN(numberPart)) {
        return undefined;
      }
      return Math.round(numberPart * multiplier);
    }
  }

  const parsed = Number.parseFloat(text);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function safeDecode(input: string | undefined): string | undefined {
  if (!input) {
    return undefined;
  }
  try {
    return decodeURIComponent(input);
  } catch {
    return input;
  }
}

function extractJsonObjectAfterMarker(html: string, marker: string): string | null {
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) {
    return null;
  }

  let start = markerIndex + marker.length;
  while (start < html.length && html[start] !== "{") {
    start += 1;
  }

  if (start >= html.length) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < html.length; i += 1) {
    const ch = html[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "{") {
      depth += 1;
      continue;
    }

    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return html.slice(start, i + 1);
      }
    }
  }

  return null;
}

function findVisionHotRankKey(record: Record<string, unknown>): string | undefined {
  return Object.keys(record).find((key) => key.includes("visionHotRank("));
}

async function fetchTextWithFetch(
  url: string,
  timeoutMs: number,
  headers: Record<string, string>,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Kuaishou endpoint returned ${response.status}`);
    }

    return response.text();
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

  const { stdout } = await execFileAsync("curl", args, {
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout;
}

function normalizeMirrorJson(json: MirrorJsonPayload): KuaishouPayload | null {
  const rows = Array.isArray(json.data) ? json.data : Array.isArray(json.items) ? json.items : [];
  const data = rows
    .map((row, index) => {
      const title =
        typeof row.title === "string"
          ? row.title.trim()
          : typeof row.name === "string"
            ? row.name.trim()
            : "";
      if (!title) return null;
      const url =
        (typeof row.url === "string" ? row.url : undefined) ??
        (typeof row.mobileUrl === "string" ? row.mobileUrl : undefined) ??
        "https://www.kuaishou.com/";
      return {
        id: typeof row.id === "string" || typeof row.id === "number" ? String(row.id) : `kuaishou-${index + 1}`,
        title,
        cover: typeof row.cover === "string" ? row.cover : undefined,
        timestamp: typeof row.timestamp === "string" ? row.timestamp : undefined,
        hot: typeof row.hot === "number" ? row.hot : parseChineseNumber(typeof row.hot === "string" ? row.hot : undefined),
        url,
        mobileUrl: url,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  if (data.length === 0) return null;
  return {
    name: "kuaishou",
    title: "快手",
    type: "热榜",
    description: "快手，拥抱每一种生活",
    link: "https://www.kuaishou.com/",
    total: data.length,
    data,
  };
}

function parseApolloHtmlToPayload(html: string): KuaishouPayload | null {
  const stateJson = extractJsonObjectAfterMarker(html, "window.__APOLLO_STATE__=");
  if (!stateJson) {
    return null;
  }

  const parsed = JSON.parse(stateJson) as { defaultClient?: Record<string, unknown> };
  const client = parsed.defaultClient;
  if (!client) {
    return null;
  }

  const rootKey = findVisionHotRankKey(client);
  if (!rootKey) {
    return null;
  }

  const root = client[rootKey] as { items?: Array<Record<string, unknown>> } | undefined;
  const items = Array.isArray(root?.items) ? root.items : [];

  const data = items
    .map((item, index) => {
      const ref =
        (typeof item.id === "string" ? item.id : undefined) ??
        (typeof item.__ref === "string" ? item.__ref : undefined);

      const detail = (ref ? client[ref] : undefined) as Record<string, unknown> | undefined;
      const detailRecord: Record<string, unknown> = detail ?? {};
      const title = typeof detailRecord.name === "string" ? detailRecord.name.trim() : "";

      if (!title) {
        return null;
      }

      const photoIds = detailRecord.photoIds as { json?: unknown[] } | undefined;
      const firstPhotoId = Array.isArray(photoIds?.json)
        ? photoIds?.json?.find((value): value is string => typeof value === "string")
        : undefined;

      const urlValue = firstPhotoId
        ? `https://www.kuaishou.com/short-video/${firstPhotoId}`
        : "https://www.kuaishou.com/";

      return {
        id:
          (typeof detailRecord.id === "string" ? detailRecord.id : undefined) ??
          (ref ?? `kuaishou-${index + 1}`),
        title,
        cover: safeDecode(typeof detailRecord.poster === "string" ? detailRecord.poster : undefined),
        timestamp: undefined,
        hot: parseChineseNumber(
          typeof detailRecord.hotValue === "string" ? detailRecord.hotValue : undefined,
        ),
        url: urlValue,
        mobileUrl: urlValue,
      };
    })
    .filter((value): value is NonNullable<typeof value> => value !== null);

  if (data.length === 0) {
    return null;
  }

  return {
    name: "kuaishou",
    title: "快手",
    type: "热榜",
    description: "快手，拥抱每一种生活",
    link: "https://www.kuaishou.com/",
    total: data.length,
    data,
  };
}

async function fetchText(url: string, timeoutMs: number, headers: Record<string, string>): Promise<string> {
  try {
    return await fetchTextWithFetch(url, timeoutMs, headers);
  } catch {
    return fetchTextWithCurl(url, timeoutMs, headers);
  }
}

export async function fetchKuaishouHotList(timeoutMs: number): Promise<KuaishouPayload> {
  const headers: Record<string, string> = {
    accept: "text/html,application/xhtml+xml,application/json",
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  };
  const mirrorUrl = getOptionalKuaishouMirrorUrl();
  const candidates = [
    "https://www.kuaishou.com/?isHome=1",
    "https://www.kuaishou.com/",
    "https://m.kuaishou.com/",
    ...(mirrorUrl ? [mirrorUrl] : []),
  ];
  const perTimeout = Math.max(700, Math.floor(timeoutMs / Math.max(1, candidates.length * 2)));
  let lastError: unknown;

  for (const url of candidates) {
    try {
      const text = await fetchText(url, perTimeout, headers);
      if (!text || !text.trim()) {
        lastError = new Error("Kuaishou page returned empty response");
        continue;
      }

      const trimmed = text.trim();
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        try {
          const json = JSON.parse(trimmed) as MirrorJsonPayload;
          const mirrorPayload = normalizeMirrorJson(json);
          if (mirrorPayload) {
            return mirrorPayload;
          }
        } catch {
          // continue to html parser
        }
      }

      const parsed = parseApolloHtmlToPayload(text);
      if (parsed) {
        return parsed;
      }
      lastError = new Error("Kuaishou hot list parse failed");
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Failed to fetch kuaishou hot list");
}
