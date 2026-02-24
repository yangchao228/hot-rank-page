const refreshBtn = document.getElementById("refreshStatusBtn");
const errorBox = document.getElementById("statusError");
const overallStatus = document.getElementById("overallStatus");
const checkedAt = document.getElementById("checkedAt");
const upstreamStatus = document.getElementById("upstreamStatus");
const upstreamLatency = document.getElementById("upstreamLatency");
const cacheStatus = document.getElementById("cacheStatus");
const cacheMeta = document.getElementById("cacheMeta");
const statusJson = document.getElementById("statusJson");
const statusSummary = document.getElementById("statusSummary");
const statusSummaryDesc = document.getElementById("statusSummaryDesc");
const fallbackJudge = document.getElementById("fallbackJudge");
const fallbackJudgeDesc = document.getElementById("fallbackJudgeDesc");
const cacheExplain = document.getElementById("cacheExplain");
const cacheExplainDesc = document.getElementById("cacheExplainDesc");
const schedulerSummary = document.getElementById("schedulerSummary");
const schedulerSourceGrid = document.getElementById("schedulerSourceGrid");

const LOCAL_FALLBACK_SOURCES = ["抖音", "快手", "微博", "知乎", "百度", "哔哩哔哩", "36氪", "今日头条", "V2EX"];
const SOURCE_ORDER = ["douyin", "kuaishou", "weibo", "zhihu", "baidu", "bilibili", "36kr", "toutiao", "v2ex"];
const SOURCE_META = {
  douyin: { name: "抖音", icon: "🎵" },
  kuaishou: { name: "快手", icon: "⚡" },
  weibo: { name: "微博", icon: "🔥" },
  zhihu: { name: "知乎", icon: "📘" },
  baidu: { name: "百度", icon: "🔎" },
  bilibili: { name: "哔哩哔哩", icon: "📺" },
  "36kr": { name: "36氪", icon: "📰" },
  toutiao: { name: "今日头条", icon: "🧭" },
  v2ex: { name: "V2EX", icon: "💬" },
};

async function fetchJson(url) {
  const response = await fetch(url);
  const json = await response.json().catch(() => null);
  if (!json) {
    throw new Error(`响应解析失败: ${response.status}`);
  }
  return {
    ok: response.ok,
    status: response.status,
    payload: json,
  };
}

function formatTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
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

function setStatusTone(element, tone) {
  element.style.color =
    tone === "ok" ? "#9df8b4" : tone === "warn" ? "#ffd7a0" : tone === "error" ? "#ffd1c4" : "";
}

function setText(el, value) {
  if (!el) return;
  el.textContent = value;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDurationMs(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "-";
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes > 0 ? `${hours} 小时 ${restMinutes} 分钟` : `${hours} 小时`;
}

function schedulerStateTone(state) {
  if (!state) return "neutral";
  if (state.gaveUpInCurrentCycle) return "error";
  if (Number(state.consecutiveFailures || 0) > 0) return "warn";
  if (state.lastSuccessAt) return "ok";
  return "neutral";
}

function schedulerStateLabel(state) {
  if (!state) return "未知";
  if (state.gaveUpInCurrentCycle) return "本轮已放弃";
  if (Number(state.consecutiveFailures || 0) > 0) return "重试中";
  if (state.lastSuccessAt) return "正常";
  return "等待首次刷新";
}

function renderSchedulerSources(scheduler) {
  if (!schedulerSourceGrid) return;

  if (!scheduler || !Array.isArray(scheduler.sources)) {
    setText(schedulerSummary, "当前版本未提供调度器明细");
    schedulerSourceGrid.innerHTML = '<div class="scheduler-source-empty">未获取到各源刷新状态。</div>';
    return;
  }

  const rows = [...scheduler.sources].sort((a, b) => {
    const ai = SOURCE_ORDER.indexOf(String(a?.source || ""));
    const bi = SOURCE_ORDER.indexOf(String(b?.source || ""));
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  const summaryParts = [
    scheduler.started ? "调度器已启动" : "调度器未启动",
    `共 ${rows.length} 个源`,
    `刷新周期 ${formatDurationMs(scheduler.refreshIntervalMs)}`,
    `失败重试 ${formatDurationMs(scheduler.retryIntervalMs)}`,
    typeof scheduler.maxConsecutiveFailures === "number" ? `连续失败上限 ${scheduler.maxConsecutiveFailures} 次` : null,
    typeof scheduler.jitterMaxMs === "number" ? `随机抖动 ${formatDurationMs(scheduler.jitterMaxMs)} 内` : null,
  ].filter(Boolean);
  setText(schedulerSummary, summaryParts.join(" · "));

  schedulerSourceGrid.innerHTML = rows
    .map((state) => {
      const sourceId = String(state?.source || "-");
      const meta = SOURCE_META[sourceId] || { name: sourceId, icon: "•" };
      const tone = schedulerStateTone(state);
      const label = schedulerStateLabel(state);
      const lastError = state?.lastError ? escapeHtml(state.lastError) : "";

      return `
        <article class="scheduler-source-card">
          <div class="scheduler-source-head">
            <div class="scheduler-source-name-wrap">
              <span class="scheduler-source-icon" aria-hidden="true">${meta.icon}</span>
              <div>
                <div class="scheduler-source-name">${escapeHtml(meta.name)}</div>
                <div class="scheduler-source-id">${escapeHtml(sourceId)}</div>
              </div>
            </div>
            <span class="scheduler-pill ${tone}">${escapeHtml(label)}</span>
          </div>
          <div class="scheduler-kv-grid">
            <div class="scheduler-kv"><span>下次刷新</span><strong>${escapeHtml(formatTime(state?.nextRunAt))}</strong></div>
            <div class="scheduler-kv"><span>上次成功</span><strong>${escapeHtml(formatTime(state?.lastSuccessAt))}</strong></div>
            <div class="scheduler-kv"><span>上次失败</span><strong>${escapeHtml(formatTime(state?.lastFailureAt))}</strong></div>
            <div class="scheduler-kv"><span>连续失败</span><strong>${escapeHtml(String(state?.consecutiveFailures ?? 0))}</strong></div>
            <div class="scheduler-kv"><span>本轮重试</span><strong>${escapeHtml(String(state?.retriesInCurrentCycle ?? 0))}</strong></div>
            <div class="scheduler-kv"><span>本轮状态</span><strong>${state?.gaveUpInCurrentCycle ? "已放弃" : "进行中"}</strong></div>
            <div class="scheduler-kv"><span>累计刷新</span><strong>${escapeHtml(String(state?.totalRefreshes ?? 0))}</strong></div>
            <div class="scheduler-kv"><span>累计失败</span><strong>${escapeHtml(String(state?.totalFailures ?? 0))}</strong></div>
          </div>
          ${
            lastError
              ? `<div class="scheduler-error-line"><span>最近错误</span><code>${lastError}</code></div>`
              : ""
          }
        </article>
      `;
    })
    .join("");
}

function renderHealth(result) {
  const payload = result?.payload || {};
  const data = payload?.data || {};
  const upstream = data.upstream || {};
  const cache = data.cache || {};
  const healthStatus = String(payload?.message || data.status || "unknown");
  const httpStatus = typeof result?.status === "number" ? result.status : 0;
  const localOnlyMode = data.mode === "local-only" || upstream.disabled === true;

  overallStatus.textContent = httpStatus ? `${healthStatus} (${httpStatus})` : healthStatus;
  checkedAt.textContent = `检查时间 ${formatTime(new Date().toISOString())}`;

  const overallTone = healthStatus === "ok" ? "ok" : healthStatus === "degraded" ? "warn" : "error";
  setStatusTone(overallStatus, overallTone);

  upstreamStatus.textContent = localOnlyMode ? "已禁用（本地模式）" : upstream.ok ? "可用" : "异常";
  upstreamLatency.textContent = `延迟 ${typeof upstream.latencyMs === "number" ? upstream.latencyMs : "-"} ms${upstream.message ? ` · ${upstream.message}` : ""}`;
  setStatusTone(upstreamStatus, localOnlyMode ? "warn" : upstream.ok ? "ok" : "error");

  const redisEnabled = Boolean(cache.redisEnabled);
  const redisReady = Boolean(cache.redisReady);
  const cacheOk = redisEnabled ? redisReady : true;
  cacheStatus.textContent = cacheOk ? (redisEnabled ? "正常" : "正常(内存)") : "降级";
  cacheMeta.textContent = [
    typeof cache.memoryKeys === "number" ? `memoryKeys ${cache.memoryKeys}` : undefined,
    redisEnabled ? `Redis ${redisReady ? "已连接" : "未就绪"}` : "Redis 未启用",
  ]
    .filter(Boolean)
    .join(" · ");
  setStatusTone(cacheStatus, cacheOk ? "ok" : "warn");

  if (localOnlyMode) {
    setText(statusSummary, "服务正常（本地模式）");
    setText(
      statusSummaryDesc,
      "已禁用 DailyHotApi，上游不再参与请求。当前由本地抓取器 + 缓存提供热榜数据。",
    );
    setStatusTone(statusSummary, "ok");
  } else if (healthStatus === "ok") {
    setText(statusSummary, "服务正常");
    setText(statusSummaryDesc, "服务在线且上游健康检查通过，常规请求通常会优先走上游 + 缓存。");
    setStatusTone(statusSummary, "ok");
  } else if (healthStatus === "degraded") {
    setText(statusSummary, "服务可用（降级中）");
    setText(statusSummaryDesc, "服务本身正常，但上游 DailyHotApi 当前探测失败。已命中的缓存仍可返回。");
    setStatusTone(statusSummary, "warn");
  } else {
    setText(statusSummary, "状态未知");
    setText(statusSummaryDesc, "健康检查返回了未识别状态，请查看下方原始响应。");
    setStatusTone(statusSummary, "error");
  }

  if (localOnlyMode) {
    setText(fallbackJudge, "本地模式（不走上游）");
    setText(
      fallbackJudgeDesc,
      `当前仅展示本地可抓取源：${LOCAL_FALLBACK_SOURCES.join("、")}。所有请求都走本地抓取器与缓存，不再使用 DailyHotApi。`,
    );
    setStatusTone(fallbackJudge, "ok");
  } else if (upstream.ok) {
    setText(fallbackJudge, "不是全部兜底");
    setText(fallbackJudgeDesc, "上游可用时，通常走上游接口。缓存命中时会直接返回缓存。");
    setStatusTone(fallbackJudge, "ok");
  } else {
    setText(fallbackJudge, "无法判定是否全部兜底");
    setText(
      fallbackJudgeDesc,
      `当前仅能确认上游不可用。已接入本地兜底的源包括：${LOCAL_FALLBACK_SOURCES.join("、")}；其他源可能依赖缓存或返回失败。`,
    );
    setStatusTone(fallbackJudge, "warn");
  }

  if (redisEnabled) {
    setText(cacheExplain, redisReady ? "已启用 Redis 缓存" : "Redis 已配置但未就绪");
    setText(
      cacheExplainDesc,
      `${typeof cache.memoryKeys === "number" ? `当前内存缓存条目 ${cache.memoryKeys} 条；` : ""}Redis ${
        redisReady ? "连接正常，可作为二级缓存使用。" : "尚未连接成功，当前主要使用内存缓存。"
      }`,
    );
    setStatusTone(cacheExplain, redisReady ? "ok" : "warn");
  } else {
    setText(cacheExplain, "当前使用内存缓存");
    setText(
      cacheExplainDesc,
      `${typeof cache.memoryKeys === "number" ? `当前内存缓存条目 ${cache.memoryKeys} 条。` : ""}未启用 Redis，这属于当前配置的正常状态。`,
    );
    setStatusTone(cacheExplain, "ok");
  }

  renderSchedulerSources(data.scheduler);
  statusJson.textContent = JSON.stringify(payload, null, 2);
}

async function loadHealth() {
  setError("");
  overallStatus.textContent = "加载中";
  try {
    const result = await fetchJson("/healthz");
    renderHealth(result);
  } catch (error) {
    setError(error instanceof Error ? error.message : String(error));
    overallStatus.textContent = "加载失败";
    setText(statusSummary, "加载失败");
    setText(statusSummaryDesc, "无法获取健康检查结果。");
    setText(fallbackJudge, "-");
    setText(fallbackJudgeDesc, "-");
    setText(cacheExplain, "-");
    setText(cacheExplainDesc, "-");
    setText(schedulerSummary, "-");
    if (schedulerSourceGrid) {
      schedulerSourceGrid.innerHTML = '<div class="scheduler-source-empty">状态加载失败，无法获取各源刷新状态。</div>';
    }
    statusJson.textContent = "{}";
  }
}

refreshBtn.addEventListener("click", () => {
  void loadHealth();
});

void loadHealth();
