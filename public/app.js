const limitInput = document.getElementById("limitInput");
const refreshBtn = document.getElementById("refreshBtn");
const errorBox = document.getElementById("errorBox");
const board = document.getElementById("board");

let sources = [];
let visibleSources = [];
let feeds = new Map();
let activeLoadToken = 0;

const SOURCE_PRIORITY = ["douyin", "kuaishou", "weibo", "zhihu"];
const SOURCE_ICONS = {
  douyin: "🎵",
  kuaishou: "⚡",
  weibo: "🧧",
  zhihu: "📘",
  baidu: "🔎",
  bilibili: "📺",
  "36kr": "📰",
  toutiao: "🗞️",
  v2ex: "💬",
};
const SOURCE_PAGE_LINKS = {
  douyin: "https://www.douyin.com/hot",
  kuaishou: "https://www.kuaishou.com/hotlist",
  weibo: "https://s.weibo.com/top/summary",
  zhihu: "https://www.zhihu.com/hot",
  baidu: "https://top.baidu.com/board?tab=realtime",
  bilibili: "https://www.bilibili.com/v/popular/all",
  "36kr": "https://www.36kr.com/hot-list/catalog",
  toutiao: "https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc",
  v2ex: "https://www.v2ex.com/?tab=hot",
};

async function fetchJson(url) {
  const response = await fetch(url);
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(json?.message || `请求失败: ${response.status}`);
  }
  return json;
}

function setError(message) {
  if (!message) {
    errorBox.classList.add("hidden");
    errorBox.textContent = "";
    return;
  }
  errorBox.classList.remove("hidden");
  errorBox.textContent = message;
}

function formatTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function buildItemMeta(item, feed) {
  const timeText = formatTime(item.timestamp || feed.updateTime);
  const normalizedTime = timeText === "-" ? "时间未知" : timeText;
  const parts = [];
  if (item.hot !== undefined && item.hot !== null && String(item.hot).trim() !== "") {
    parts.push(`热度 ${String(item.hot)}`);
  }
  parts.push(`时间 ${normalizedTime}`);
  return parts.join(" · ");
}

function renderTabs(categories) {
  categoryTabs.innerHTML = "";
  const allTab = document.createElement("button");
  allTab.className = `tab${selectedCategory === "全部" ? " active" : ""}`;
  allTab.textContent = "全部";
  allTab.addEventListener("click", () => {
    selectedCategory = "全部";
    renderTabs(categories);
    renderBoard();
  });
  categoryTabs.appendChild(allTab);

  categories.forEach((category) => {
    const tab = document.createElement("button");
    tab.className = `tab${selectedCategory === category ? " active" : ""}`;
    tab.textContent = category;
    tab.addEventListener("click", () => {
      selectedCategory = category;
      renderTabs(categories);
      renderBoard();
    });
    categoryTabs.appendChild(tab);
  });
}

function buildItemDesc(item, feed) {
  const hiddenDescSources = new Set(["zhihu", "douyin", "kuaishou"]);
  if (hiddenDescSources.has(item.source || feed.source)) return "";
  return typeof item.desc === "string" ? item.desc.trim() : "";
}

function createSourceIcon(sourceId) {
  return SOURCE_ICONS[sourceId] || "🔥";
}

function createStateBlock(kind, text) {
  const box = document.createElement("div");
  box.className = `source-status ${kind}`;

  if (kind === "loading") {
    const spinner = document.createElement("span");
    spinner.className = "spinner";
    spinner.setAttribute("aria-hidden", "true");
    box.appendChild(spinner);
  }

  const label = document.createElement("span");
  label.textContent = text;
  box.appendChild(label);

  return box;
}

function sortSourcesForDisplay(list) {
  const sourceOrder = new Map(sources.map((source, index) => [source.id, index]));
  return [...list].sort((a, b) => {
    const ai = SOURCE_PRIORITY.indexOf(a.id);
    const bi = SOURCE_PRIORITY.indexOf(b.id);
    const aRank = ai === -1 ? Number.MAX_SAFE_INTEGER : ai;
    const bRank = bi === -1 ? Number.MAX_SAFE_INTEGER : bi;
    if (aRank !== bRank) {
      return aRank - bRank;
    }
    return (sourceOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (sourceOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER);
  });
}

function renderBoard() {
  board.innerHTML = "";
  const grid = document.createElement("div");
  grid.className = "source-grid";

  sortSourcesForDisplay(visibleSources).forEach((source) => {
    const card = document.createElement("div");
    card.className = "source-card";
    const feed = feeds.get(source.id);

    const header = document.createElement("div");
    header.className = "source-header";

    const ident = document.createElement("div");
    ident.className = "source-ident";

    const icon = document.createElement("div");
    icon.className = "source-icon";
    icon.textContent = createSourceIcon(source.id);

    const titleWrap = document.createElement("div");
    titleWrap.className = "source-title-wrap";

    const name = document.createElement("a");
    name.className = "source-title source-title-link";
    name.href = feed?.link || SOURCE_PAGE_LINKS[source.id] || "#";
    name.target = "_blank";
    name.rel = "noreferrer";
    name.textContent = source.title;

    const type = document.createElement("div");
    type.className = "source-type";
    type.textContent = source.type;

    titleWrap.appendChild(name);
    titleWrap.appendChild(type);
    ident.appendChild(icon);
    ident.appendChild(titleWrap);

    const headerMeta = document.createElement("div");
    headerMeta.className = "source-header-meta";

    const itemCount = Array.isArray(feed?.items) ? feed.items.length : 0;
    const countBadge = document.createElement("div");
    countBadge.className = "source-badge";
    if (feed?.loading && itemCount > 0) {
      countBadge.classList.add("is-warn");
      countBadge.textContent = "刷新中";
    } else if (feed?.loading) {
      countBadge.classList.add("is-loading");
      countBadge.textContent = "加载中";
    } else if (feed?.error && itemCount > 0) {
      countBadge.classList.add("is-warn");
      countBadge.textContent = "旧数据";
    } else if (feed?.error) {
      countBadge.classList.add("is-error");
      countBadge.textContent = "失败";
    } else {
      countBadge.textContent = `${itemCount} 条`;
    }
    headerMeta.appendChild(countBadge);

    header.appendChild(ident);
    header.appendChild(headerMeta);
    card.appendChild(header);

    const list = document.createElement("ul");
    list.className = "source-list";

    const hasItems = !!feed && Array.isArray(feed.items) && feed.items.length > 0;
    if (!hasItems && feed?.loading) {
      card.appendChild(createStateBlock("loading", "加载中..."));
      grid.appendChild(card);
      return;
    }

    if (!hasItems && feed?.error) {
      card.appendChild(createStateBlock("error", feed.message || "加载失败"));
      grid.appendChild(card);
      return;
    }

    feed.items.forEach((item, index) => {
      const row = document.createElement("li");
      row.className = "source-item";

      const top = document.createElement("div");
      top.className = "source-item-top";

      const rank = document.createElement("span");
      rank.className = "source-rank";
      rank.textContent = String(index + 1).padStart(2, "0");

      const link = document.createElement("a");
      link.className = "source-link";
      link.href = item.url || item.mobileUrl || "#";
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = item.title || "(untitled)";

      const meta = document.createElement("span");
      meta.className = "source-item-meta";
      meta.textContent = buildItemMeta(item, feed);

      top.appendChild(rank);
      top.appendChild(link);
      row.appendChild(top);
      row.appendChild(meta);

      const descText = buildItemDesc(item, feed);
      if (descText) {
        const desc = document.createElement("span");
        desc.className = "source-item-desc";
        desc.textContent = descText;
        row.appendChild(desc);
      }
      list.appendChild(row);
    });

    if (list.children.length === 0) {
      return;
    }

    card.appendChild(list);

    if (feed?.loading) {
      card.appendChild(createStateBlock("loading-inline", "正在刷新..."));
    } else if (feed?.error) {
      card.appendChild(createStateBlock("warn-inline", "刷新失败，当前展示旧数据"));
    }

    grid.appendChild(card);
  });

  if (grid.children.length > 0) {
    board.appendChild(grid);
  }

  if (board.children.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "当前没有可展示的数据源";
    board.appendChild(empty);
  }
}

async function loadSources() {
  const response = await fetchJson("/api/v1/sources");
  sources = response.data || [];
  visibleSources = sortSourcesForDisplay(sources);
}

async function loadFeeds() {
  setError("");
  const limit = Number.parseInt(limitInput.value, 10) || 8;
  const loadToken = ++activeLoadToken;
  const previousFeeds = feeds;
  feeds = new Map();
  visibleSources = sortSourcesForDisplay(sources);

  for (const source of sources) {
    const prev = previousFeeds.get(source.id);
    const hasPrevItems = Array.isArray(prev?.items) && prev.items.length > 0;
    if (hasPrevItems) {
      feeds.set(source.id, {
        ...prev,
        loading: true,
        error: false,
        message: "",
      });
    } else {
      feeds.set(source.id, {
        loading: true,
        error: false,
        message: "",
        items: [],
      });
    }
  }
  renderBoard();

  let successCount = 0;

  await Promise.allSettled(
    sources.map(async (source) => {
      try {
        const response = await fetchJson(`/api/v1/hot/${source.id}?limit=${limit}`);
        if (loadToken !== activeLoadToken) return;
        successCount += 1;
        feeds.set(source.id, {
          ...response.data,
          loading: false,
          error: false,
          message: "",
        });
        setError("");
        renderBoard();
      } catch (error) {
        if (loadToken !== activeLoadToken) return;
        const prev = feeds.get(source.id);
        const hasPrevItems = Array.isArray(prev?.items) && prev.items.length > 0;
        if (hasPrevItems) {
          feeds.set(source.id, {
            ...prev,
            loading: false,
            error: true,
            message: error instanceof Error ? error.message : String(error),
          });
        } else {
          feeds.set(source.id, {
            loading: false,
            error: true,
            message: error instanceof Error ? error.message : String(error),
            items: [],
          });
        }
        renderBoard();
      }
    }),
  );

  if (loadToken !== activeLoadToken) return;
  if (successCount === 0) {
    setError("当前没有可用热榜源");
  }
}

async function bootstrap() {
  try {
    await loadSources();
    await loadFeeds();
  } catch (error) {
    setError(error instanceof Error ? error.message : String(error));
  }
}

refreshBtn.addEventListener("click", () => {
  void loadFeeds();
});

limitInput.addEventListener("change", () => {
  void loadFeeds();
});

void bootstrap();
