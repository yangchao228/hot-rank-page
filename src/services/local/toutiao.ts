import { ensureAbsoluteUrl, parseNumber, requestJson, toIso } from './http.js';

interface ToutiaoItem {
  ClusterId?: number | string;
  ClusterIdStr?: string;
  Title?: string;
  Url?: string;
  HotValue?: number | string;
  HotValueFormat?: string;
  Label?: string;
  LabelDesc?: string;
  Time?: number | string;
  PublishTime?: number | string;
  UpdateTime?: number | string;
}

interface ToutiaoResponse {
  data?: ToutiaoItem[];
}

export interface ToutiaoPayload {
  name: 'toutiao';
  title: '今日头条';
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

export async function fetchToutiaoHotList(timeoutMs: number): Promise<ToutiaoPayload> {
  const json = await requestJson<ToutiaoResponse>('https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc', {
    timeoutMs,
    headers: {
      accept: 'application/json, text/plain, */*',
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      referer: 'https://www.toutiao.com/',
    },
    maxBufferBytes: 6 * 1024 * 1024,
  });

  const rows = Array.isArray(json.data) ? json.data : [];
  const data = rows
    .map((row, index) => {
      const title = typeof row.Title === 'string' ? row.Title.trim() : '';
      if (!title) return null;
      const url =
        ensureAbsoluteUrl(typeof row.Url === 'string' ? row.Url : undefined, 'https://www.toutiao.com') ??
        `https://www.toutiao.com/search/?keyword=${encodeURIComponent(title)}`;
      return {
        id: String(row.ClusterIdStr ?? row.ClusterId ?? index + 1),
        title,
        desc: [row.Label, row.LabelDesc].filter((v) => typeof v === 'string' && v).join(' · ') || undefined,
        hot: parseNumber(row.HotValue ?? row.HotValueFormat),
        timestamp: toIso(row.Time ?? row.PublishTime ?? row.UpdateTime),
        url,
        mobileUrl: url,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  if (data.length === 0) {
    throw new Error('Toutiao hot board returned empty data');
  }

  return {
    name: 'toutiao',
    title: '今日头条',
    type: '热榜',
    description: '头条热门榜',
    link: 'https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc',
    total: data.length,
    data,
  };
}
