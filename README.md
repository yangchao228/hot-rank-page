# Hot Rank Service

基于 [imsyy/DailyHotApi](https://github.com/imsyy/DailyHotApi) 的热榜服务，采用“上游代理 + 本地缓存（TTL + SWR）”架构。

## 功能

- 核心兼容路由：`/all`、`/:source`
- 统一标准化 API：`/api/v1/sources`、`/api/v1/hot/:source`、`/api/v1/hot/aggregate`
- RSS 兼容：`/:source?rss=true`
- 本地缓存：内存 SWR（可选 Redis 二级缓存）
- 基础容错：重试、熔断、过期缓存降级
- 公网限流：普通 API 与聚合 API 分级限流
- 集中展示页：`/`（全量源 + 分类 tab）
- 健康检查：`/healthz`

## 首版榜单（12 个）

- `weibo`
- `zhihu`
- `baidu`
- `bilibili`
- `douyin`
- `kuaishou`
- `juejin`
- `36kr`
- `ithome`
- `toutiao`
- `v2ex`
- `github`

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
| `UPSTREAM_BASE_URL` | `https://api-hot.imsyy.top` | DailyHotApi 上游地址 |
| `ZHIHU_COOKIE` | 空 | 可选：知乎 Cookie（用于提升请求稳定性） |
| `CACHE_TTL_SECONDS` | `300` | Fresh 缓存时长 |
| `CACHE_STALE_SECONDS` | `1800` | Stale 窗口时长 |
| `REQUEST_TIMEOUT_MS` | `6000` | 上游请求超时 |
| `RETRY_TIMES` | `2` | 上游失败重试次数 |
| `CIRCUIT_FAIL_THRESHOLD` | `3` | 熔断失败阈值 |
| `CIRCUIT_COOLDOWN_MS` | `30000` | 熔断冷却时间 |
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

兼容 DailyHotApi 核心接口。

支持公共参数：

- `limit`: 限制条目数
- `cache=false`: 跳过缓存
- `rss=true`: 返回 RSS XML

其余参数按源白名单透传（例如 `type`）。

### 统一接口

#### `GET /api/v1/sources`

返回可用源及参数说明。

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

返回服务健康、上游连通性与缓存状态。

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

- 上游故障：查看 `/healthz` 的 `upstream` 字段和服务日志。
- 频繁 429：调高限流配置或在网关层做分流。
- Redis 未启用：确认 `USE_REDIS=true` 且 `REDIS_URL` 可连接。

## 免责声明

本项目仅用于技术研究与开发测试，请遵守目标站点条款与当地法律法规。
