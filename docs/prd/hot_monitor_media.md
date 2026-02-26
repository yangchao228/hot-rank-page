# PRD：热榜监测（Hot Monitor for Media）

版本：v0.2（已合并评审结论，供确认）  
负责人：你 / Codex（协作）  
创建日期：2026-02-26  
关联代码仓库：`hot-rank-page`（本地抓取 + 本地缓存 + 标准化 API）

---

## 1. 背景与问题

现有服务已能稳定抓取多个平台热榜，并提供统一 API、聚合与 RSS 输出。但对于“自媒体内容创作”场景，仍缺少：

- **个性化**：不同创作者关心的赛道、关键词、排除项不同。
- **持续监测**：需要在“新上榜 / 快速上升 / 多平台共振”出现时及时发现，而不是手动刷新。
- **可复用输出**：把热点变成可直接用于创作的结构化素材（选题、角度、标题、素材链接、发布时间建议等）。

因此需要新增“热榜监测”能力，将“热榜数据”升级为“可配置的信号 + 通知 + 创作素材流水线”。

---

## 2. 目标与非目标

### 2.1 目标（MVP）

1. 支持创建 **监测器（Monitor）**：选择来源（source）+ 规则（关键词/正则/黑白名单/阈值）+ 信号类型。
2. 周期性运行监测：在服务端内部调度并产出 **事件（Event）**。
3. 事件可消费：
   - API 查询（用于后续做前端工作台）
   - 生成个性化 RSS（MVP 优先，用于选题库消费）
   - 后续扩展：飞书通知（机器人 Webhook）
4. 支持“创作友好”的事件字段：尽量包含原链接、移动端链接、热度、排名、时间、来源、匹配原因。

### 2.2 非目标（暂不做）

- 完整的多租户账号体系（先按“单人/小团队自部署”设计）
- 复杂 NLP/LLM 自动写稿（可留接口，但不在 MVP 验收范围）
- 对所有平台做深度反爬对抗（仍遵循现有抓取策略与容错）

---

## 3. 用户画像与使用场景

### 3.1 目标用户

- 自媒体作者/运营：需要快速发现符合赛道的热点并形成选题清单。
- 小团队内容中台：对“多个账号、多个赛道”做订阅与分发。

### 3.2 典型场景

1. **赛道监控**：例如“AI 工具/应用”关键词组合，捕捉上榜和快速上升。
2. **竞品/品牌监控**：某品牌/产品名出现即提醒，同时排除无关歧义词。
3. **多源共振**：同一话题在微博 + 知乎 + 今日头条同时出现，优先级更高。
4. **每日选题盘点**：每天固定时间生成“候选选题 Top N”。

---

## 4. 核心概念定义

- **Source**：平台热榜来源（如 `weibo/zhihu/toutiao/...`），来自现有服务能力。
- **Monitor（监测器）**：用户定义的一组监测配置（source 集合 + 规则 + 输出方式）。
- **Signal（信号）**：触发事件的类型，例如“新上榜”“热度超过阈值”“排名上升超过阈值”“多源共振”。
- **Event（事件）**：某次监测运行产生的可消费记录（用于通知/列表/RSS/导出）。

---

## 5. 需求范围（MVP 功能）

### 5.1 监测器管理

- 创建 / 更新 / 删除 / 启停 Monitor
- Monitor 字段（建议）：
  - `name`：监测器名称
  - `sources`：来源数组（如 `["weibo","zhihu"]`）
  - `schedule`：运行频率（MVP：每 5 分钟）
  - `rules`：匹配规则（见 5.2）
  - `signals`：启用的信号类型与阈值
  - `dedupeWindow`：事件去重窗口（避免刷屏）
  - `freshnessHalfLifeMinutes`：新鲜度半衰期（可配置，用于选题排序/降权老热点，默认 360=6h）
  - `persistenceWindowHours`：持续性统计窗口（默认 24h）
  - `outputs`：输出通道（MVP：RSS；后续：飞书 Webhook）

实现策略（与评审结论对齐）：
- MVP 先内置 1 个“赛道 Monitor”验证闭环（单赛道）。
- 数据模型与接口保留 `monitors[]` 结构，后续可无损扩展为多赛道多 Monitor 并行。

### 5.2 规则引擎（匹配）

支持至少以下规则组合（AND/OR 需明确）：

- 包含关键词：`includeKeywords`（数组）
- 排除关键词：`excludeKeywords`（数组）
- 可选：正则匹配 `includeRegex` / `excludeRegex`
- 可选：来源内字段匹配范围（`title/desc`）

匹配结果需在 Event 中给出 `matchReason`（例如命中关键词列表/正则）。

### 5.3 信号类型（触发条件）

MVP 先支持：

1. **NewItem**：新上榜（本次出现，上次未出现）
2. **HotThreshold**：热度字段（若有）超过阈值
3. **RankUp**：排名上升超过阈值（需要保存上次快照）
4. **MultiSource**：同一标题/URL 在多个 source 同周期内出现
5. **Persistence（新增建议）**：热点“持久度”达到阈值（以 **24h 内出现次数** 为主指标，例如 `last24hSeenCount >= N`）

说明：
- 不同 source 的“热度/排名”字段可能不一致，允许部分信号在某些 source 上不可用，并在 Monitor 配置校验时提示。
- `Persistence` 需要依赖快照累计的 `firstSeenAt/lastSeenAt/seenCount`，以及“窗口内出现次数”（例如 `last24hSeenCount`）。
- 建议同时引入“新鲜度”控制避免老热点长期霸榜（见 5.3.1），且半衰期需可配置。

#### 5.3.1 权重与排序（用于“候选选题 Top N”）

如果要做“每日选题盘点/候选选题 Top N”，建议引入统一评分（score），把“持续时间越长权重越高”纳入排序：

- `persistenceScore = log(1 + last24hSeenCount)`（以 24h 内出现次数为主，避免线性膨胀）
- 同时加入“新鲜度衰减”，避免旧热点一直高分：`freshnessScore = exp(-(now - lastSeenAt)/halfLifeMs)`（其中 `halfLifeMs` 由 `freshnessHalfLifeMinutes` 配置）

最终可组合（示例）：

- `score = w_p * persistenceScore + w_f * freshnessScore + w_m * multiSourceCount + w_r * rankUpDelta + w_h * normalizedHot`

其中 `w_*` 可在 Monitor 内配置或使用默认值。

默认值（与评审结论对齐）：
- `Persistence` 阈值：`last24hSeenCount >= 5`
- `freshnessHalfLifeMinutes`：360（6h）

### 5.4 事件消费与输出

1. **事件查询 API**
   - 按 monitor、时间范围、信号类型、source 过滤
2. **个性化 RSS**
   - 每个 Monitor 一个 RSS Feed
   - RSS item 以“候选选题（Candidate Topic）”为主（偏选题库），而不是纯事件流
3. **飞书通知（后续扩展）**
   - 通过飞书机器人 Webhook 推送候选选题 Top N 或高优先级信号
   - 不纳入 MVP 验收范围，但在配置模型中预留输出通道与重试策略

### 5.5 创作友好字段（事件内容）

Event 应包含（尽量从现有标准化 item 衍生）：

- `title`、`desc`（如有）
- `url`、`mobileUrl`（如有）
- `source`（平台）与 `sourceTitle`（展示名）
- `rank`（若可解析）与 `hot`（若有）
- `firstSeenAt` / `lastSeenAt`
- `seenCount`（累计出现次数）
- `last24hSeenCount`（24h 窗口内出现次数，作为持久度计算依据）
- `signalType`
- `matchReason`（命中原因）
- `raw`（可选：保留原始字段用于后续增强）

---

## 6. 交互形态（阶段性）

### 6.1 Phase 1（MVP）

- 仅提供 API + RSS（RSS 优先，用于选题库消费）
- Monitor 配置通过：
  - 配置文件（JSON/YAML），或
  - 简单 REST API（更利于后续前端工作台）

### 6.2 Phase 2（增强）

- Web 工作台：
  - Monitor 可视化配置
  - 事件流（Timeline）
  - 一键“加入选题库/导出 Markdown”

---

## 7. 数据与存储（建议方案）

### 7.1 最小可行存储

- Monitor 配置：本地文件持久化（如 `data/monitors.json`）
- 事件与快照：本地文件或轻量 KV（例如 SQLite/JSONL）

理由：自部署优先、易迁移、无外部依赖；后续可平滑升级 Redis/SQLite。

### 7.2 去重与幂等

- Event `id` 推荐可复现（如 `hash(monitorId + source + item.url/title + signalType + bucketTime)`）
- 支持 `dedupeWindow`：同一条内容在窗口内只发一次（或合并为一次）

---

## 8. API（建议草案）

> 仅用于对齐后续研发，不作为最终接口冻结承诺。

- `GET /api/v1/monitors`
- `POST /api/v1/monitors`
- `GET /api/v1/monitors/:id`
- `PATCH /api/v1/monitors/:id`
- `DELETE /api/v1/monitors/:id`
- `GET /api/v1/monitors/:id/events?from=&to=&signal=&source=`
- `GET /api/v1/monitors/:id/rss`（返回 RSS XML）
- `POST /api/v1/monitors/:id/test-webhook`（可选）

---

## 9. 验收标准（MVP）

1. 能创建至少 1 个 Monitor（例如监控 `weibo+zhihu` 的关键词“AI/大模型/应用”）。
2. 服务在后台按配置频率运行监测，并在：
   - 新上榜、排名上升、多源共振等条件满足时产生 Event。
   - （若启用）热点持续时间达到阈值时产生 Event。
3. Event 可通过 API 查询，并可通过 RSS 正常订阅（产生 `<item>`）。
4. RSS 输出偏“选题库”：能看到近 24h 的候选选题聚合条目（包含评分、命中原因、覆盖来源/次数）。
5. 去重窗口生效（同一热点不会在短时间内重复推送）。
6. 稳定性：单个 source 抓取失败不影响其他 source 监测；失败会记录到状态/事件日志中（至少可定位）。

---

## 10. 里程碑（建议）

- M1：Monitor 配置模型 + 存储 + 校验（1–2 天）
- M2：快照对比（NewItem/RankUp）+ Event 产出（2–4 天）
- M3：RSS 输出（候选选题/按 Monitor）+ API 查询（1–2 天）
- M4（后续）：飞书 Webhook（机器人）+ 重试与签名（1–2 天）
- M5：最小工作台（可选）（视需求）

---

## 11. 风险与依赖

- **反爬与稳定性**：各平台可用性波动会直接影响监测质量；需要复用现有的镜像/降级策略。
- **字段差异**：不同 source 的 `hot/rank` 不一致，信号需要“可用性声明”与降级策略。
- **去重策略**：按 `url` 优先、缺失按 `title`，可能存在误合并/漏合并，需要可配置。
- **通知可靠性**（若上 Webhook）：需要重试与限流，避免阻塞主流程。

---

## 12. 待评审问题（请你确认）

1. 你更希望 **先做 RSS** 还是 **先做 Webhook**？（两者都做也可，但会影响 MVP 周期）
   - 评审结论：先做 RSS
2. 监测频率目标：5 分钟 / 1 分钟 / 自定义？
   - 评审结论：5 分钟
3. 是否需要“多赛道多 Monitor”并行（例如 5–20 个）？这会影响存储与调度策略。
   - 评审结论：先做单赛道验证（但需可扩展为多 Monitor）
4. 通知落地偏好：飞书 / 企业微信 / Telegram / Email / 通用 Webhook？
   - 评审结论：飞书（作为后续输出通道）
5. 事件输出希望“更偏选题库”（聚合去重）还是“更偏实时提醒”（事件流）？
   - 评审结论：更偏选题库
6. 关于“热点持续时间越长权重越高”：你希望用 **连续出现时长**、还是 **24h 内出现次数** 作为主指标？是否需要“新鲜度衰减半衰期”配置（例如 2h/6h/24h）？
   - 评审结论：以 **24h 内出现次数** 为主指标；半衰期 **需要可配置**。

默认值（已确认）：
- `Persistence`：`last24hSeenCount >= 5`
- `freshnessHalfLifeMinutes`：360（6h）
