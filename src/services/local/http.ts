import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

interface RequestOptions {
  timeoutMs: number;
  headers?: Record<string, string>;
  maxBufferBytes?: number;
}

export async function requestText(url: string, options: RequestOptions): Promise<string> {
  const headers = options.headers ?? {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status}`);
    }
    const text = await response.text();
    if (!text.trim()) {
      throw new Error("Empty response");
    }
    return text;
  } catch {
    const args = ["-sL", "--max-time", String(Math.ceil(options.timeoutMs / 1000)), url];
    for (const [key, value] of Object.entries(headers)) {
      args.push("-H", `${key}: ${value}`);
    }
    const { stdout } = await execFileAsync("curl", args, {
      maxBuffer: options.maxBufferBytes ?? 8 * 1024 * 1024,
    });
    if (!stdout.trim()) {
      throw new Error("Empty response");
    }
    return stdout;
  } finally {
    clearTimeout(timer);
  }
}

export async function requestJson<T>(url: string, options: RequestOptions): Promise<T> {
  const text = await requestText(url, options);
  return JSON.parse(text) as T;
}

export function toIso(value: unknown): string | undefined {
  if (typeof value === "number") {
    const ms = value > 946684800000 ? value : value * 1000;
    return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
  }
  if (typeof value !== "string" || value.trim() === "") {
    return undefined;
  }
  const raw = value.trim();
  if (/^\d+$/.test(raw)) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed)) {
      return undefined;
    }
    return toIso(parsed);
  }
  const ts = Date.parse(raw);
  if (!Number.isFinite(ts)) {
    return undefined;
  }
  return new Date(ts).toISOString();
}

export function parseNumber(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.replace(/[,，\s]/g, "");
  if (!normalized) {
    return undefined;
  }
  const unitMatch = normalized.match(/^([0-9]+(?:\.[0-9]+)?)(亿|万|千)?$/);
  if (unitMatch) {
    const amount = Number.parseFloat(unitMatch[1] ?? "");
    if (Number.isNaN(amount)) {
      return undefined;
    }
    const unit = unitMatch[2];
    const multiplier = unit === "亿" ? 100000000 : unit === "万" ? 10000 : unit === "千" ? 1000 : 1;
    return Math.round(amount * multiplier);
  }
  const parsed = Number.parseInt(normalized.replace(/\D+/g, ""), 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export function ensureAbsoluteUrl(url: string | undefined, fallbackBase: string): string | undefined {
  if (!url) {
    return undefined;
  }
  try {
    return new URL(url, fallbackBase).toString();
  } catch {
    return undefined;
  }
}

