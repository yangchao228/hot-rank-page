import { env } from "../config/env.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

interface RequestOptions {
  source: string;
  query: Record<string, string>;
  accept: "application/json" | "application/xml";
}

export class CircuitOpenError extends Error {
  retryAfterMs: number;

  constructor(retryAfterMs: number) {
    super("Upstream circuit is open");
    this.retryAfterMs = retryAfterMs;
  }
}

export class DnsLookupError extends Error {
  constructor(message: string) {
    super(message);
  }
}

interface CircuitState {
  failures: number;
  openedUntil: number;
}

export class UpstreamClient {
  private readonly baseUrl: string;

  private readonly timeoutMs: number;

  private readonly retryTimes: number;

  private readonly failureThreshold: number;

  private readonly cooldownMs: number;

  private readonly circuitMap = new Map<string, CircuitState>();

  constructor(options?: {
    baseUrl?: string;
    timeoutMs?: number;
    retryTimes?: number;
    failureThreshold?: number;
    cooldownMs?: number;
  }) {
    this.baseUrl = options?.baseUrl ?? env.UPSTREAM_BASE_URL;
    this.timeoutMs = options?.timeoutMs ?? env.REQUEST_TIMEOUT_MS;
    this.retryTimes = options?.retryTimes ?? env.RETRY_TIMES;
    this.failureThreshold = options?.failureThreshold ?? env.CIRCUIT_FAIL_THRESHOLD;
    this.cooldownMs = options?.cooldownMs ?? env.CIRCUIT_COOLDOWN_MS;
  }

  private checkCircuit(source: string): void {
    const state = this.circuitMap.get(source);
    if (!state) {
      return;
    }

    const now = Date.now();
    if (state.openedUntil > now) {
      throw new CircuitOpenError(state.openedUntil - now);
    }

    if (state.openedUntil > 0 && state.openedUntil <= now) {
      this.circuitMap.set(source, { failures: 0, openedUntil: 0 });
    }
  }

  private markFailure(source: string): void {
    const existing = this.circuitMap.get(source) ?? { failures: 0, openedUntil: 0 };
    const failures = existing.failures + 1;
    const shouldOpen = failures >= this.failureThreshold;
    this.circuitMap.set(source, {
      failures,
      openedUntil: shouldOpen ? Date.now() + this.cooldownMs : 0,
    });
  }

  private markSuccess(source: string): void {
    this.circuitMap.set(source, { failures: 0, openedUntil: 0 });
  }

  private buildUrl(source: string, query: Record<string, string>): string {
    const url = new URL(`/${source}`, this.baseUrl);
    for (const [key, value] of Object.entries(query)) {
      if (value !== "") {
        url.searchParams.set(key, value);
      }
    }
    return url.toString();
  }

  private isDnsError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }
    const cause = error.cause as { code?: string } | undefined;
    if (cause?.code === "ENOTFOUND") {
      return true;
    }
    return error.message.includes("ENOTFOUND") || error.message.includes("getaddrinfo");
  }

  private async fetchWithCurl(url: string, accept: string): Promise<string> {
    const args = [
      "-sL",
      "--max-time",
      String(Math.ceil(this.timeoutMs / 1000)),
      "-H",
      `accept: ${accept}`,
      url,
    ];
    const { stdout } = await execFileAsync("curl", args, { maxBuffer: 10 * 1024 * 1024 });
    return stdout;
  }

  private async request(options: RequestOptions): Promise<Response> {
    const { source, query, accept } = options;
    this.checkCircuit(source);

    const url = this.buildUrl(source, query);

    let lastError: unknown;

    for (let attempt = 0; attempt <= this.retryTimes; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await fetch(url, {
          method: "GET",
          headers: {
            accept,
          },
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
          throw new Error(`Upstream returned ${response.status}`);
        }

        this.markSuccess(source);
        return response;
      } catch (error) {
        clearTimeout(timeout);
        lastError = error;
        if (this.isDnsError(error)) {
          throw new DnsLookupError("Upstream DNS lookup failed");
        }
        this.markFailure(source);
      }
    }

    throw lastError instanceof Error ? lastError : new Error("Unknown upstream error");
  }

  async fetchJson(source: string, query: Record<string, string>): Promise<Record<string, unknown>> {
    try {
      const response = await this.request({
        source,
        query,
        accept: "application/json",
      });
      return (await response.json()) as Record<string, unknown>;
    } catch (error) {
      if (error instanceof DnsLookupError) {
        const url = this.buildUrl(source, query);
        const body = await this.fetchWithCurl(url, "application/json");
        return JSON.parse(body) as Record<string, unknown>;
      }
      throw error;
    }
  }

  async fetchRss(source: string, query: Record<string, string>): Promise<string> {
    try {
      const response = await this.request({
        source,
        query,
        accept: "application/xml",
      });
      return response.text();
    } catch (error) {
      if (error instanceof DnsLookupError) {
        const url = this.buildUrl(source, query);
        return this.fetchWithCurl(url, "application/xml");
      }
      throw error;
    }
  }

  async ping(): Promise<{ ok: boolean; latencyMs: number; message?: string }> {
    const start = Date.now();
    try {
      const response = await fetch(new URL("/all", this.baseUrl), {
        method: "GET",
      });
      const latencyMs = Date.now() - start;
      if (!response.ok) {
        return { ok: false, latencyMs, message: `status ${response.status}` };
      }
      return { ok: true, latencyMs };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
