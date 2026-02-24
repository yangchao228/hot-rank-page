import { afterEach, describe, expect, test, vi } from "vitest";
import { fetchBaiduHotList } from "../src/services/local/baidu.js";
import { fetchBilibiliHotList } from "../src/services/local/bilibili.js";
import { fetch36KrHotList } from "../src/services/local/kr36.js";
import { fetchToutiaoHotList } from "../src/services/local/toutiao.js";
import { fetchV2exHotList } from "../src/services/local/v2ex.js";
import { fetchKuaishouHotList } from "../src/services/local/kuaishou.js";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.V2EX_MIRROR_BASE_URL;
  delete process.env.BILIBILI_MIRROR_API_URL;
  delete process.env.KUAISHOU_MIRROR_URL;
});

describe("local source parsers", () => {
  test("parses baidu hot board response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            success: true,
            data: {
              cards: [
                {
                  component: "hotList",
                  content: [
                    {
                      key: "1",
                      query: "百度测试词",
                      appUrl: "https://www.baidu.com/s?wd=%E6%B5%8B%E8%AF%95",
                      desc: "百度描述",
                      hotScore: "12345",
                    },
                  ],
                },
              ],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ) as unknown as typeof fetch,
    );

    const payload = await fetchBaiduHotList(3000);
    expect(payload.name).toBe("baidu");
    expect(payload.data[0]?.title).toBe("百度测试词");
    expect(payload.data[0]?.hot).toBe(12345);
  });

  test("parses bilibili ranking response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            code: 0,
            data: {
              list: [
                {
                  aid: 123,
                  bvid: "BV1xx411c7mD",
                  title: "B站测试视频",
                  pubdate: 1771669800,
                  owner: { name: "测试UP" },
                  stat: { view: 998877 },
                },
              ],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ) as unknown as typeof fetch,
    );

    const payload = await fetchBilibiliHotList(3000);
    expect(payload.name).toBe("bilibili");
    expect(payload.data[0]?.title).toBe("B站测试视频");
    expect(payload.data[0]?.url).toContain("BV1xx411c7mD");
    expect(payload.data[0]?.hot).toBe(998877);
  });

  test("uses optional bilibili mirror api when configured", async () => {
    process.env.BILIBILI_MIRROR_API_URL = "https://mirror.example.com/bilibili-hot";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("api.bilibili.com") || url.includes("app.bilibili.com")) {
          return new Response(JSON.stringify({ code: -352, message: "risk control" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url === "https://mirror.example.com/bilibili-hot") {
          return new Response(
            JSON.stringify({
              code: 0,
              data: {
                items: [
                  {
                    aid: 456,
                    bvid: "BV1mirror",
                    title: "镜像 B站热榜",
                    owner: { name: "mirrorUP" },
                    stat: { view: 1234 },
                    pubdate: 1771669800,
                  },
                ],
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response("{}", { status: 500 });
      }) as unknown as typeof fetch,
    );

    const payload = await fetchBilibiliHotList(3000);
    expect(payload.name).toBe("bilibili");
    expect(payload.data[0]?.title).toBe("镜像 B站热榜");
  });

  test("parses toutiao hot board response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            data: [
              {
                ClusterId: 1001,
                Title: "头条测试词",
                Url: "/trending/1001/",
                Label: "hot",
                HotValue: "66.8万",
                Time: 1771669800,
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ) as unknown as typeof fetch,
    );

    const payload = await fetchToutiaoHotList(3000);
    expect(payload.name).toBe("toutiao");
    expect(payload.data[0]?.title).toBe("头条测试词");
    expect(payload.data[0]?.url).toContain("/trending/1001/");
    expect(payload.data[0]?.hot).toBe(668000);
  });

  test("parses v2ex hot topics api response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify([
            {
              id: 42,
              title: "V2EX 测试主题",
              url: "https://www.v2ex.com/t/42",
              replies: 12,
              last_modified: 1771669800,
              member: { username: "alice" },
              node: { title: "程序员" },
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ) as unknown as typeof fetch,
    );

    const payload = await fetchV2exHotList(3000);
    expect(payload.name).toBe("v2ex");
    expect(payload.data[0]?.title).toBe("V2EX 测试主题");
    expect(payload.data[0]?.hot).toBe(12);
    expect(payload.data[0]?.desc).toContain("程序员");
  });

  test("uses optional kuaishou mirror url when configured", async () => {
    process.env.KUAISHOU_MIRROR_URL = "https://mirror.example.com/kuaishou-hot";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("kuaishou.com") && !url.includes("mirror.example.com")) {
          return new Response("", { status: 500 });
        }
        if (url === "https://mirror.example.com/kuaishou-hot") {
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: "ks-1",
                  title: "镜像快手热词",
                  hot: "99.9万",
                  url: "https://www.kuaishou.com/short-video/ks1",
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response("", { status: 500 });
      }) as unknown as typeof fetch,
    );

    const payload = await fetchKuaishouHotList(3000);
    expect(payload.name).toBe("kuaishou");
    expect(payload.data[0]?.title).toBe("镜像快手热词");
    expect(payload.data[0]?.hot).toBe(999000);
  });

  test("falls back to v2ex hot html when api fails", async () => {
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        callCount += 1;
        if (callCount <= 2) {
          return new Response("blocked", { status: 500 });
        }
        return new Response(
          `
          <div class="cell item">
            <table><tr>
              <td class="item_title"><a class="topic-link" href="/t/123456">HTML 兜底主题</a></td>
              <td><a class="count_livid">34</a></td>
            </tr></table>
            <span class="small fade">
              <a class="node">问与答</a>
              <strong><a>bob</a></strong>
            </span>
          </div></div>
          `,
          { status: 200, headers: { "content-type": "text/html" } },
        );
      }) as unknown as typeof fetch,
    );

    const payload = await fetchV2exHotList(3000);
    expect(payload.name).toBe("v2ex");
    expect(payload.data[0]?.title).toBe("HTML 兜底主题");
    expect(payload.data[0]?.hot).toBe(34);
  });

  test("falls back to v2ex rss when api and html fail", async () => {
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        callCount += 1;
        if (callCount <= 5) {
          return new Response("blocked", { status: 500 });
        }
        return new Response(
          `<?xml version="1.0" encoding="UTF-8"?>
          <rss version="2.0"><channel>
            <item>
              <title><![CDATA[V2EX RSS 兜底主题]]></title>
              <link>https://www.v2ex.com/t/654321</link>
              <description><![CDATA[<p>RSS desc</p>]]></description>
              <pubDate>Tue, 24 Feb 2026 07:00:00 GMT</pubDate>
            </item>
          </channel></rss>`,
          { status: 200, headers: { "content-type": "application/xml" } },
        );
      }) as unknown as typeof fetch,
    );

    const payload = await fetchV2exHotList(3000);
    expect(payload.name).toBe("v2ex");
    expect(payload.data[0]?.title).toBe("V2EX RSS 兜底主题");
    expect(payload.data[0]?.url).toContain("/t/654321");
  });

  test("uses optional v2ex mirror api when configured", async () => {
    process.env.V2EX_MIRROR_BASE_URL = "https://mirror.example.com";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.startsWith("https://www.v2ex.com/api/topics/hot.json")) {
          return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
        }
        if (url.startsWith("https://v2ex.com/api/topics/hot.json")) {
          return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
        }
        if (url.startsWith("https://www.v2ex.com/api/topics/latest.json")) {
          return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
        }
        if (url.startsWith("https://mirror.example.com/api/topics/hot.json")) {
          return new Response(
            JSON.stringify([
              {
                id: 888,
                title: "镜像 V2EX 主题",
                url: "/t/888",
                replies: 23,
                created: 1771669800,
              },
            ]),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
      }) as unknown as typeof fetch,
    );

    const payload = await fetchV2exHotList(3000);
    expect(payload.name).toBe("v2ex");
    expect(payload.data[0]?.title).toBe("镜像 V2EX 主题");
    expect(payload.data[0]?.hot).toBe(23);
  });

  test("falls back to built-in jina proxy for v2ex api", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("r.jina.ai/http://www.v2ex.com/api/topics/hot.json")) {
          return new Response(
            `Title: \n\nURL Source: http://www.v2ex.com/api/topics/hot.json\n\nMarkdown Content:\n[{"id":777,"title":"Jina V2EX 主题","url":"https://www.v2ex.com/t/777","replies":7,"last_modified":1771669800}]`,
            { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } },
          );
        }
        if (url.includes("v2ex.com/api/topics/")) {
          return new Response("blocked", { status: 500, headers: { "content-type": "text/plain" } });
        }
        return new Response("blocked", { status: 500, headers: { "content-type": "text/plain" } });
      }) as unknown as typeof fetch,
    );

    const payload = await fetchV2exHotList(3000);
    expect(payload.name).toBe("v2ex");
    expect(payload.data[0]?.title).toBe("Jina V2EX 主题");
    expect(payload.data[0]?.hot).toBe(7);
    expect(payload.data[0]?.url).toContain("/t/777");
  });

  test("uses built-in v2ex mirror api when official api is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("global.v2ex.co/api/topics/hot.json")) {
          return new Response(
            JSON.stringify([
              {
                id: 999,
                title: "Global V2EX 镜像主题",
                url: "https://www.v2ex.com/t/999",
                replies: 99,
                last_modified: 1771669800,
              },
            ]),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.includes("v2ex.com/api/topics/")) {
          return new Response("blocked", { status: 500, headers: { "content-type": "text/plain" } });
        }
        return new Response("blocked", { status: 500, headers: { "content-type": "text/plain" } });
      }) as unknown as typeof fetch,
    );

    const payload = await fetchV2exHotList(3000);
    expect(payload.name).toBe("v2ex");
    expect(payload.data[0]?.title).toBe("Global V2EX 镜像主题");
    expect(payload.data[0]?.hot).toBe(99);
  });

  test("parses 36kr hot list from html links fallback", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          `
          <!doctype html>
          <html><body>
            <a href="/p/123456789">36kr 测试热文标题一</a>
            <a href="/p/987654321">36kr 测试热文标题二</a>
          </body></html>
          `,
          { status: 200, headers: { "content-type": "text/html" } },
        ),
      ) as unknown as typeof fetch,
    );

    const payload = await fetch36KrHotList(3000);
    expect(payload.name).toBe("36kr");
    expect(payload.data.length).toBeGreaterThanOrEqual(2);
    expect(payload.data[0]?.url).toContain("36kr.com/p/");
  });

  test("falls back to 36kr rss when page parsing fails", async () => {
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        callCount += 1;
        if (callCount <= 4) {
          return new Response("<html><body>no items</body></html>", {
            status: 200,
            headers: { "content-type": "text/html" },
          });
        }
        return new Response(
          `<?xml version="1.0" encoding="UTF-8"?>
          <rss version="2.0"><channel>
            <item>
              <title><![CDATA[36kr RSS 测试标题]]></title>
              <link>https://www.36kr.com/p/123456789</link>
              <description><![CDATA[<p>RSS 描述</p>]]></description>
              <pubDate>Tue, 24 Feb 2026 06:00:00 GMT</pubDate>
              <guid>kr-rss-1</guid>
            </item>
          </channel></rss>`,
          { status: 200, headers: { "content-type": "application/xml" } },
        );
      }) as unknown as typeof fetch,
    );

    const payload = await fetch36KrHotList(3000);
    expect(payload.name).toBe("36kr");
    expect(payload.data[0]?.title).toBe("36kr RSS 测试标题");
    expect(payload.data[0]?.url).toContain("36kr.com/p/123456789");
  });
});
