---
name: wanspilot-api
description: WansPilot HTTP API 契约——新增或修改 /api 端点必须做全的步骤（路由、认证、响应、API.md、测试），以及 SSE、图片代理、脱敏约定。改接口时使用。
---

# WansPilot API 变更

## 加一个端点，五步都要做完
1. 路由：`content/server/index.mjs` 里加 `pathname === '/api/xxx' && method === 'GET'` 分支。顺序敏感——`/api/tasks` 必须排在 `/api/tasks/:id` 之前。
2. 认证：除 `/api/health`、`/api/auth/*`、静态资源外，写操作要过 `authenticated(req)` 与 `sameOrigin(req)`（`content/server/auth.mjs`）。登录是 scrypt 哈希 + cookie，入口 `login(req, value)`。
3. 响应：统一用 `sendJson(res, status, payload, extraHeaders)`（`index.mjs:123`）或 `sendText`，不要手写 `writeHead` + `JSON.stringify`。可缓存的响应带 `etag` / `cache-control`，与现有静态资源分支保持一致。
4. 文档：同步 `API.md`，写清方法+路径、参数、成功响应、错误响应。这份文档是前端和外部调用方的唯一契约。
5. 测试：在 `verify/tests/api.test.mjs`（或对应模块测试）补三条路径——成功、参数缺失/非法、未认证。

## 现状速查
- 认证端点：`GET /api/auth/status`、`POST /api/auth/login`、`POST /api/auth/logout`。
- SSE：`/api/tasks/events` 用 `text/event-stream` 长连接推任务状态。改任务字段时必须同步前端事件处理与 `API.md` 的事件说明。
- 图片代理：`GET /api/image?path=/x.jpg&size=w342`，走 image-cache 与白名单。
- 端点分组：health/system、settings、tmdb、resources、tasks、subscriptions、organizer/calendar/capacity、logs。
- 配置持久化在 `/data/settings.json`；对外只经 `publicSettings` 脱敏，apiKey / 密码 / token **不得**出现在响应里。

## 错误约定
- 4xx/5xx 一律 `sendJson(res, code, { error: '<中文可读原因>' })`，前端按 `error` 字段展示。
- 不要把 TMDB / qBittorrent / 索引器的原始堆栈透给前端；日志用 `redact()`（`log.mjs`）过滤密钥。
- 上游超时、429、解析失败要转成稳定的业务错误文案，并让前端能区分「可重试」与「配置错误」。
