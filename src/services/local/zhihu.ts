import { env } from "../../config/env.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

interface ZhihuHotTarget {
  id: number;
  title: string;
  url: string;
  created?: number;
  excerpt?: string;
}

interface ZhihuHotItem {
  target: ZhihuHotTarget;
  detail_text?: string;
  children?: Array<{ thumbnail?: string }>;
}

interface ZhihuHotResponse {
  data: ZhihuHotItem[];
}

function parseHot(detailText: string | undefined): number | undefined {
  if (!detailText) {
    return undefined;
  }
  const numberPart = detailText.split(" ")[0];
  if (!numberPart) {
    return undefined;
  }
  const parsed = Number.parseFloat(numberPart);
  if (Number.isNaN(parsed)) {
    return undefined;
  }
  return parsed * 10000;
}

function epochSecondsToIso(epochSeconds: number | undefined): string | undefined {
  if (!epochSeconds) {
    return undefined;
  }
  const ms = epochSeconds * 1000;
  return new Date(ms).toISOString();
}

function getQuestionIdFromUrl(url: string): string {
  const parts = url.split("/");
  const last = parts[parts.length - 1] || "";
  return last.trim();
}

export interface ZhihuPayload {
  name: "zhihu";
  title: "知乎";
  type: "热榜";
  description: string;
  link: string;
  total: number;
  data: Array<{
    id: number;
    title: string;
    desc?: string;
    cover?: string;
    timestamp?: string;
    hot?: number;
    url: string;
    mobileUrl: string;
  }>;
}

async function fetchJsonWithCurl(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<ZhihuHotResponse> {
  const args = ["-sL", "--max-time", String(Math.ceil(timeoutMs / 1000)), url];
  for (const [key, value] of Object.entries(headers)) {
    args.push("-H", `${key}: ${value}`);
  }

  const { stdout } = await execFileAsync("curl", args, { maxBuffer: 5 * 1024 * 1024 });
  const parsed = JSON.parse(stdout) as ZhihuHotResponse;
  return parsed;
}

function shouldFallbackToCurl(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const cause = error.cause as { code?: string } | undefined;
  if (cause?.code === "ENOTFOUND") {
    return true;
  }
  return error.message.includes("ENOTFOUND") || error.message.includes("getaddrinfo");
}

export async function fetchZhihuHotList(timeoutMs: number): Promise<ZhihuPayload> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers: Record<string, string> = {
      accept: "application/json",
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      ...(env.ZHIHU_COOKIE ? { cookie: env.ZHIHU_COOKIE } : {}),
    };

    let json: Partial<ZhihuHotResponse>;

    try {
      const response = await fetch("https://api.zhihu.com/topstory/hot-lists/total?limit=50", {
        method: "GET",
        headers,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Zhihu API returned ${response.status}`);
      }

      json = (await response.json()) as Partial<ZhihuHotResponse>;
    } catch (error) {
      if (!shouldFallbackToCurl(error)) {
        throw error;
      }
      json = await fetchJsonWithCurl(
        "https://api.zhihu.com/topstory/hot-lists/total?limit=50",
        headers,
        timeoutMs,
      );
    }
    const list = Array.isArray(json.data) ? json.data : [];

    const data = list
      .map((item) => {
        const target = item.target;
        if (!target || typeof target.title !== "string" || typeof target.url !== "string") {
          return null;
        }

        const questionId = getQuestionIdFromUrl(target.url);
        const url = `https://www.zhihu.com/question/${questionId}`;

        return {
          id: target.id,
          title: target.title,
          desc: target.excerpt,
          cover: item.children?.[0]?.thumbnail,
          timestamp: epochSecondsToIso(target.created),
          hot: parseHot(item.detail_text),
          url,
          mobileUrl: url,
        };
      })
      .filter((value): value is NonNullable<typeof value> => value !== null);

    return {
      name: "zhihu",
      title: "知乎",
      type: "热榜",
      description: "知乎热榜",
      link: "https://www.zhihu.com/hot",
      total: data.length,
      data,
    };
  } finally {
    clearTimeout(timer);
  }
}
