import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { isSupportedSource, type SourceId } from "../domain/sources.js";
import type { MonitorDefinition } from "../types/monitor.js";

function isValidRegexPattern(pattern: string): boolean {
  try {
    // Validate syntax only; flags are controlled by runtime (`i`).
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

const monitorRuleSchema = z.object({
  includeKeywords: z.array(z.string()).default([]),
  excludeKeywords: z.array(z.string()).default([]),
  includeRegex: z
    .string()
    .optional()
    .refine(
      (value) => value === undefined || (value.trim().length > 0 && isValidRegexPattern(value)),
      "Invalid includeRegex",
    ),
  excludeRegex: z
    .string()
    .optional()
    .refine(
      (value) => value === undefined || (value.trim().length > 0 && isValidRegexPattern(value)),
      "Invalid excludeRegex",
    ),
  fields: z.array(z.enum(["title", "desc"])).default(["title", "desc"]),
});

const monitorSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean().default(true),
  sources: z
    .array(z.string())
    .min(1)
    .transform((values, ctx): SourceId[] => {
      const supported: SourceId[] = [];
      for (const value of values) {
        if (!isSupportedSource(value)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Unsupported source: ${value}`,
          });
          continue;
        }
        supported.push(value);
      }
      return supported;
    }),
  scheduleMinutes: z.number().int().min(1).default(5),
  rule: monitorRuleSchema.default({
    includeKeywords: [],
    excludeKeywords: [],
    fields: ["title", "desc"],
  }),
  scoring: z
    .object({
      persistenceWindowHours: z.number().int().min(1).default(24),
      persistenceThreshold: z.number().int().min(1).default(5),
      freshnessHalfLifeMinutes: z.number().int().min(1).default(360),
    })
    .default({
      persistenceWindowHours: 24,
      persistenceThreshold: 5,
      freshnessHalfLifeMinutes: 360,
    }),
  outputs: z
    .object({
      rss: z
        .object({
          enabled: z.boolean().default(true),
          topN: z.number().int().min(1).max(200).default(30),
        })
        .default({ enabled: true, topN: 30 }),
    })
    .default({ rss: { enabled: true, topN: 30 } }),
});

const monitorsFileSchema = z.object({
  version: z.number().int().optional(),
  monitors: z.array(monitorSchema).default([]),
});

export async function readMonitorDefinitions(configPath: string): Promise<MonitorDefinition[]> {
  const absolute = path.isAbsolute(configPath) ? configPath : path.resolve(process.cwd(), configPath);
  const raw = await fs.readFile(absolute, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  const result = monitorsFileSchema.parse(parsed);
  return result.monitors;
}
