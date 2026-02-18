function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

interface RssItemInput {
  title: string;
  link: string;
  description?: string;
  pubDate?: string;
}

interface RssFeedInput {
  title: string;
  link: string;
  description?: string;
  items: RssItemInput[];
}

export function buildRssXml(feed: RssFeedInput): string {
  const title = escapeXml(feed.title);
  const link = escapeXml(feed.link);
  const description = escapeXml(feed.description ?? "");

  const itemsXml = feed.items
    .map((item) => {
      const itemTitle = escapeXml(item.title);
      const itemLink = escapeXml(item.link);
      const itemDesc = escapeXml(item.description ?? "");
      const pubDate = item.pubDate ? `<pubDate>${escapeXml(item.pubDate)}</pubDate>` : "";

      return [
        "<item>",
        `<title>${itemTitle}</title>`,
        `<link>${itemLink}</link>`,
        `<guid>${itemLink}</guid>`,
        `<description>${itemDesc}</description>`,
        pubDate,
        "</item>",
      ]
        .filter(Boolean)
        .join("");
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>` +
    `<rss version="2.0"><channel>` +
    `<title>${title}</title>` +
    `<link>${link}</link>` +
    `<description>${description}</description>` +
    itemsXml +
    `</channel></rss>`;
}

