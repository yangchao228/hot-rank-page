# Hot Rank Service

本地抓取版热榜服务，采用“本地抓取器 + 本地缓存（TTL + SWR）”架构。

## 功能

- 核心兼容路由：`/all`、`/:source`
- 统一标准化 API：`/api/v1/sources`、`/api/v1/hot/:source`、`/api/v1/hot/aggregate`
- RSS 兼容：`/:source?rss=true`
- 本地缓存：内存 SWR（可选 Redis 二级缓存）
- 基础容错：过期缓存降级（SWR）
- 公网限流：普通 API 与聚合 API 分级限流
- 集中展示页：`/`（本地可用源集中展示）
- 状态检查页：`/status`
- 状态页增强：每个源展示最近 3 次拉取记录（时间 + 成功/失败 + 耗时 + 错误摘要）
- 健康检查：`/healthz`

## 当前支持榜单（本地可用 9 个）

- `douyin`
- `kuaishou`
- `weibo`
- `zhihu`
- `baidu`
- `bilibili`
- `36kr`
- `toutiao`
- `v2ex`

## 快速开始

### 1) 安装依赖

```bash
npm install
```

### 2) 配置环境变量

```bash
cp .env.example .env
```

### 3) 本地开发

```bash
npm run dev
```

默认地址：`http://localhost:6688`

### 4) 构建与启动

```bash
npm run build
npm run start
```

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `6688` | 服务端口 |
| `ZHIHU_COOKIE` | 空 | 可选：知乎 Cookie（用于提升请求稳定性） |
| `CACHE_TTL_SECONDS` | `300` | Fresh 缓存时长 |
| `CACHE_STALE_SECONDS` | `1800` | Stale 窗口时长 |
| `REQUEST_TIMEOUT_MS` | `6000` | 本地抓取请求超时（用于各源抓取器） |
| `BILIBILI_MIRROR_API_URL` | 空 | 可选：B站热榜镜像 API（默认关闭，需返回兼容 JSON） |
| `KUAISHOU_MIRROR_URL` | 空 | 可选：快手热榜镜像 URL（默认关闭，可返回 HTML 或 JSON） |
| `V2EX_MIRROR_BASE_URL` | 空 | 可选：V2EX 第三方镜像基地址（默认关闭，仅本地配置开启） |
| `RATE_LIMIT_WINDOW_MS` | `60000` | 限流窗口 |
| `RATE_LIMIT_MAX` | `120` | 普通接口每窗口最大请求/IP |
| `AGGREGATE_RATE_LIMIT_MAX` | `30` | 聚合接口每窗口最大请求/IP |
| `USE_REDIS` | `false` | 是否启用 Redis 二级缓存 |
| `REDIS_URL` | 空 | Redis 连接串 |
| `REDIS_PREFIX` | `hot-rank` | Redis key 前缀 |
| `CORS_ORIGIN` | `*` | CORS 允许源 |

## API

### 兼容接口

#### `GET /all`

返回已接入榜单列表。

#### `GET /:source`

兼容历史核心接口风格（本地-only 实现）。

支持公共参数：

- `limit`: 限制条目数
- `cache=false`: 跳过缓存
- `rss=true`: 返回 RSS XML

当前本地源不使用额外参数，`limit/cache/rss` 仍可用。

### 统一接口

#### `GET /api/v1/sources`

返回当前本地可用源（9 个）及参数说明。

#### `GET /api/v1/hot/:source`

返回标准化结构：

```json
{
  "code": 200,
  "message": "ok",
  "data": {
    "source": "weibo",
    "title": "微博",
    "type": "热搜榜",
    "link": "https://...",
    "total": 20,
    "fromCache": true,
    "updateTime": "2026-02-15T09:00:00.000Z",
    "items": [
      {
        "id": "1",
        "title": "...",
        "url": "https://...",
        "mobileUrl": "https://...",
        "desc": "...",
        "hot": "12345",
        "timestamp": "2026-02-15T09:00:00.000Z",
        "source": "weibo",
        "raw": {}
      }
    ]
  }
}
```

#### `GET /api/v1/hot/aggregate?sources=weibo,zhihu&limit=20`

多源聚合接口：

- 去重规则：优先按 `url`，缺失时按 `title`
- 排序规则：按 `timestamp` 倒序

#### `GET /healthz`

返回服务健康与缓存状态。

在当前版本中，`/healthz` 会明确标识 `local-only` 模式，上游字段仅用于说明“已禁用”。

调度器源状态字段补充：

- `data.scheduler.sources[].recentPulls`：最近 3 次拉取记录，包含 `at/status/mode/durationMs/error?`。

## 热榜监测（MVP：选题库 / RSS）

监测配置默认从 `data/monitors.json` 读取；运行状态（话题出现次数等）默认写入 `data/monitor-state.json`（已加入 `.gitignore`，建议挂载 volume 持久化）。

### 接口

- `GET /api/v1/monitors`：查看当前 Monitor 列表
- `GET /api/v1/monitors/:id/topics?limit=30&minCount=1&refresh=true`：获取候选选题（JSON）
- `GET /api/v1/monitors/:id/rss?limit=30&minCount=5&refresh=true`：获取候选选题 RSS（XML）

说明：
- `refresh=true`：请求时先跑一次监测（用于调试/手动触发；生产建议依赖后台 5 分钟调度）。
- `minCount`：筛选 `last24hSeenCount >= minCount` 的候选选题；`/topics` 与 RSS 若不传默认均使用 Monitor 的 `persistenceThreshold`（当前默认 5）。

## Docker

### Build

```bash
docker build -t hot-rank-page:latest .
```

### Run

```bash
docker run --rm -p 6688:6688 --env-file .env hot-rank-page:latest
```

### Docker Compose

```bash
docker compose up -d --build
```

## 测试

```bash
npm run test:run
```

当前包含：

- 缓存状态与刷新锁测试
- 业务服务标准化/聚合测试
- 路由集成测试（兼容 + v1）

## 故障排查

- 本地模式说明：查看 `/healthz` 的 `mode=local-only` 与 `upstream.disabled=true`。
- 某个源 502：通常是目标站点网络不可达或反爬导致，先查看 `/status` 页面（包含最近 3 次拉取记录）与服务日志。
- `v2ex` 502：可在本地 `.env` 配置 `V2EX_MIRROR_BASE_URL` 启用镜像 fallback（默认关闭）。
- `bilibili` / `kuaishou` 502：若本机网络或 DNS 不可达，可分别配置 `BILIBILI_MIRROR_API_URL` / `KUAISHOU_MIRROR_URL` 启用本地镜像 fallback。
- 频繁 429：调高限流配置或在网关层做分流。
- Redis 未启用：确认 `USE_REDIS=true` 且 `REDIS_URL` 可连接。

## 免责声明

本项目仅用于技术研究与开发测试，请遵守目标站点条款与当地法律法规。
