import { ensureAbsoluteUrl, parseNumber, requestJson } from './http.js';

interface BaiduBoardResponse {
  success?: boolean;
  data?: {
    cards?: Array<{
      component?: string;
      content?: Array<Record<string, unknown>>;
    }>;
  };
}

export interface BaiduPayload {
  name: 'baidu';
  title: '百度';
  type: '热搜榜';
  description: string;
  link: string;
  total: number;
  data: Array<{
    id: string;
    title: string;
    desc?: string;
    hot?: number;
    url: string;
    mobileUrl: string;
  }>;
}

export async function fetchBaiduHotList(timeoutMs: number): Promise<BaiduPayload> {
  const json = await requestJson<BaiduBoardResponse>('https://top.baidu.com/api/board?tab=realtime', {
    timeoutMs,
    headers: {
      accept: 'application/json, text/plain, */*',
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      referer: 'https://top.baidu.com/board?tab=realtime',
    },
    maxBufferBytes: 6 * 1024 * 1024,
  });

  const cards = Array.isArray(json.data?.cards) ? json.data.cards : [];
  const rows = cards.flatMap((card) => (Array.isArray(card.content) ? card.content : []));

  const data = rows
    .map((row, index) => {
      const title = String(row.query ?? row.word ?? row.title ?? '').trim();
      if (!title) return null;
      const url =
        ensureAbsoluteUrl(typeof row.appUrl === 'string' ? row.appUrl : undefined, 'https://www.baidu.com') ??
        `https://www.baidu.com/s?wd=${encodeURIComponent(title)}`;
      return {
        id: String(row.key ?? row.id ?? row.index ?? index + 1),
        title,
        desc: typeof row.desc === 'string' ? row.desc.trim() || undefined : undefined,
        hot: parseNumber(row.hotScore ?? row.hot_score ?? row.hotValue),
        url,
        mobileUrl: url,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  if (data.length === 0) {
    throw new Error('Baidu hot list returned empty data');
  }

  return {
    name: 'baidu',
    title: '百度',
    type: '热搜榜',
    description: '百度热搜榜',
    link: 'https://top.baidu.com/board?tab=realtime',
    total: data.length,
    data,
  };
}
