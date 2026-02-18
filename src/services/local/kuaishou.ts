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

export async function fetchKuaishouHotList(timeoutMs: number): Promise<KuaishouPayload> {
  const url = "https://www.kuaishou.com/?isHome=1";
  const headers: Record<string, string> = {
    accept: "text/html,application/xhtml+xml",
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  };

  let html: string;
  try {
    html = await fetchTextWithFetch(url, timeoutMs, headers);
  } catch {
    html = await fetchTextWithCurl(url, timeoutMs, headers);
  }

  if (!html || html.trim() === "") {
    throw new Error("Kuaishou page returned empty response");
  }

  const stateJson = extractJsonObjectAfterMarker(html, "window.__APOLLO_STATE__=");
  if (!stateJson) {
    throw new Error("Kuaishou APOLLO_STATE not found");
  }

  const parsed = JSON.parse(stateJson) as { defaultClient?: Record<string, unknown> };
  const client = parsed.defaultClient;
  if (!client) {
    throw new Error("Kuaishou defaultClient not found");
  }

  const rootKey = findVisionHotRankKey(client);
  if (!rootKey) {
    throw new Error("Kuaishou visionHotRank key not found");
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
