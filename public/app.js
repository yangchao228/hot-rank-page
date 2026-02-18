const categoryTabs = document.getElementById("categoryTabs");
const limitInput = document.getElementById("limitInput");
const refreshBtn = document.getElementById("refreshBtn");
const statusText = document.getElementById("statusText");
const updateTime = document.getElementById("updateTime");
const successText = document.getElementById("successText");
const errorBox = document.getElementById("errorBox");
const board = document.getElementById("board");

let sources = [];
let visibleSources = [];
let feeds = new Map();
let selectedCategory = "全部";

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

function groupByCategory() {
  const map = new Map();
  visibleSources.forEach((source) => {
    if (!map.has(source.category)) {
      map.set(source.category, []);
    }
    map.get(source.category).push(source);
  });
  return map;
}

function renderBoard() {
  board.innerHTML = "";
  const grouped = groupByCategory();
  const categories = Array.from(grouped.keys());

  categories.forEach((category) => {
    if (selectedCategory !== "全部" && selectedCategory !== category) {
      return;
    }

    const section = document.createElement("section");
    section.className = "category-section";

    const title = document.createElement("h2");
    title.className = "category-title";
    title.textContent = category;
    section.appendChild(title);

    const grid = document.createElement("div");
    grid.className = "source-grid";

    grouped.get(category).forEach((source) => {
      const card = document.createElement("div");
      card.className = "source-card";

      const header = document.createElement("div");
      header.className = "source-header";

      const name = document.createElement("div");
      name.className = "source-title";
      name.textContent = source.title;

      const type = document.createElement("div");
      type.className = "source-type";
      type.textContent = source.type;

      header.appendChild(name);
      header.appendChild(type);
      card.appendChild(header);

      const list = document.createElement("ul");
      list.className = "source-list";

      const feed = feeds.get(source.id);
      if (!feed || feed.error || !Array.isArray(feed.items) || feed.items.length === 0) {
        return;
      }
      feed.items.forEach((item) => {
        const row = document.createElement("li");
        row.className = "source-item";

        const link = document.createElement("a");
        link.href = item.url || item.mobileUrl || "#";
        link.target = "_blank";
        link.rel = "noreferrer";
        link.textContent = item.title || "(untitled)";

        const meta = document.createElement("span");
        meta.textContent = item.desc || "";

        row.appendChild(link);
        if (item.desc) {
          row.appendChild(meta);
        }
        list.appendChild(row);
      });

      if (list.children.length === 0) {
        return;
      }

      card.appendChild(list);
      grid.appendChild(card);
    });

    if (grid.children.length === 0) {
      return;
    }

    section.appendChild(grid);
    board.appendChild(section);
  });

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
  visibleSources = [...sources];
  const categories = Array.from(new Set(visibleSources.map((source) => source.category))).sort();
  renderTabs(categories);
}

async function loadFeeds() {
  setError("");
  statusText.textContent = "加载中";
  const limit = Number.parseInt(limitInput.value, 10) || 8;

  const results = await Promise.allSettled(
    sources.map(async (source) => {
      const response = await fetchJson(`/api/v1/hot/${source.id}?limit=${limit}`);
      return { source: source.id, data: response.data };
    }),
  );

  feeds = new Map();
  const successSourceIds = new Set();
  let successCount = 0;
  let failedCount = 0;
  const times = [];

  results.forEach((result, index) => {
    const sourceId = sources[index]?.id;
    if (result.status === "fulfilled") {
      successCount += 1;
      successSourceIds.add(result.value.source);
      feeds.set(result.value.source, result.value.data);
      if (result.value.data.updateTime) {
        times.push(result.value.data.updateTime);
      }
      return;
    }
    failedCount += 1;
    if (sourceId) feeds.delete(sourceId);
  });

  visibleSources = sources.filter((source) => successSourceIds.has(source.id));
  const categories = Array.from(new Set(visibleSources.map((source) => source.category))).sort();
  if (selectedCategory !== "全部" && !categories.includes(selectedCategory)) {
    selectedCategory = "全部";
  }
  renderTabs(categories);

  statusText.textContent = failedCount === 0 ? "正常" : "部分异常";
  updateTime.textContent = times.length > 0 ? formatTime(times.sort().reverse()[0]) : "-";
  successText.textContent = `${successCount}/${sources.length}`;
  if (successCount === 0) {
    setError("当前没有可用热榜源");
  }

  renderBoard();
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
