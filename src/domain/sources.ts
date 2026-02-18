import type { CompatRoute } from "../types/hot.js";

export type SourceId =
  | "weibo"
  | "zhihu"
  | "baidu"
  | "bilibili"
  | "douyin"
  | "kuaishou"
  | "juejin"
  | "36kr"
  | "ithome"
  | "toutiao"
  | "v2ex"
  | "github";

export interface SourceDefinition {
  id: SourceId;
  title: string;
  type: string;
  description: string;
  category: "综合" | "社区" | "科技";
  allowedParams: readonly string[];
}

export const SOURCE_DEFINITIONS: readonly SourceDefinition[] = [
  {
    id: "weibo",
    title: "微博",
    type: "热搜榜",
    description: "实时热点榜单",
    category: "综合",
    allowedParams: [],
  },
  {
    id: "zhihu",
    title: "知乎",
    type: "热榜",
    description: "知乎热榜",
    category: "社区",
    allowedParams: [],
  },
  {
    id: "baidu",
    title: "百度",
    type: "热搜榜",
    description: "百度热搜",
    category: "综合",
    allowedParams: ["type"],
  },
  {
    id: "bilibili",
    title: "哔哩哔哩",
    type: "热门榜",
    description: "B 站热门内容",
    category: "社区",
    allowedParams: ["type"],
  },
  {
    id: "douyin",
    title: "抖音",
    type: "热点榜",
    description: "抖音热点",
    category: "综合",
    allowedParams: [],
  },
  {
    id: "kuaishou",
    title: "快手",
    type: "热点榜",
    description: "快手热点",
    category: "综合",
    allowedParams: [],
  },
  {
    id: "juejin",
    title: "稀土掘金",
    type: "热榜",
    description: "掘金热门内容",
    category: "科技",
    allowedParams: ["type"],
  },
  {
    id: "36kr",
    title: "36 氪",
    type: "热榜",
    description: "36kr 热门资讯",
    category: "科技",
    allowedParams: ["type"],
  },
  {
    id: "ithome",
    title: "IT之家",
    type: "热榜",
    description: "IT 资讯热门榜",
    category: "科技",
    allowedParams: [],
  },
  {
    id: "toutiao",
    title: "今日头条",
    type: "热榜",
    description: "头条热门榜",
    category: "科技",
    allowedParams: [],
  },
  {
    id: "v2ex",
    title: "V2EX",
    type: "主题榜",
    description: "V2EX 热门主题",
    category: "社区",
    allowedParams: ["type"],
  },
  {
    id: "github",
    title: "GitHub",
    type: "趋势榜",
    description: "GitHub Trending",
    category: "科技",
    allowedParams: ["type"],
  },
];

export const SOURCE_MAP = new Map<SourceId, SourceDefinition>(
  SOURCE_DEFINITIONS.map((source) => [source.id, source]),
);

export function isSupportedSource(source: string): source is SourceId {
  return SOURCE_MAP.has(source as SourceId);
}

export function listCompatRoutes(): CompatRoute[] {
  return SOURCE_DEFINITIONS.map((source) => ({
    name: source.id,
    path: `/${source.id}`,
    title: source.title,
    type: source.type,
  }));
}

export function pickAllowedQuery(source: SourceId, query: Record<string, string>): Record<string, string> {
  const allowed = new Set(SOURCE_MAP.get(source)?.allowedParams ?? []);
  const picked: Record<string, string> = {};

  for (const [key, value] of Object.entries(query)) {
    if (allowed.has(key) && value !== "") {
      picked[key] = value;
    }
  }

  return picked;
}
