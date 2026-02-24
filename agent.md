# Agent Notes (hot-rank-page)

This repo is a local-only hot-rank service (no DailyHotApi dependency).

## Quick Commands

- Install: `npm install`
- Dev: `npm run dev` (default `http://localhost:6688`)
- Build: `npm run build`
- Start: `npm run start`
- Tests: `npm run test:run`

## Useful Endpoints

- UI: `GET /`
- Status UI: `GET /status`
- Health JSON: `GET /healthz`
- Sources: `GET /api/v1/sources`
- Single source: `GET /api/v1/hot/:source`
- Aggregate: `GET /api/v1/hot/aggregate?sources=weibo,zhihu&limit=20`
- Compat: `GET /all`, `GET /:source`, `GET /:source?rss=true`

## Scheduler / Status Expectations

- The background scheduler refreshes each source hourly with up to 5 minutes jitter.
- On failure, it retries every 5 minutes; after 3 consecutive failures it gives up the current cycle.
- `/healthz` includes per-source scheduler state in `data.scheduler.sources[]`.
  - `recentPulls` keeps the last 3 refresh attempts (time + success/failure + mode + duration + error).

## Where To Look When A Source Fails

- Check `/status` first.
  - Each source card shows the current scheduler state and the latest 3 pull attempts.
  - The "source-level recent errors" panel only reflects backend fetch/scheduler failures (not frontend cache issues).
- If needed, inspect server logs (stdout) for the failing source.

