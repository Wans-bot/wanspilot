---
name: wanspilot-dev
description: WansPilot 自托管影视下载编排器的开发流程——无框架 Node 后端 + 原生 ES 模块前端、构建/测试/发布/部署命令、时区与文件规模红线、NAS 部署事实。加功能、修后端、发版、排查部署问题时使用。
---

# WansPilot 开发

## 事实基线（不要按常规 Web 项目假设）
- 后端 `content/server/*.mjs`：只用 Node 内置 `http`，无 Express/Fastify，无 TypeScript，无打包。入口 `content/server/index.mjs`（770 行，路由是线性的 `if (pathname === ...)` 分发）。
- 前端 `content/web/`：浏览器直接加载 ES 模块，**没有构建步骤、没有框架**。`app.js` 约 223 KB / 4536 行，是最大的单文件。
- 运行时依赖只有 `fast-xml-parser` 与 `undici`（`content/package.json`）。新增依赖要有充分理由——镜像体积和启动速度是产品特性。
- `content/web/time.js` 是唯一时间格式化入口，`TIME_ZONE = 'Asia/Shanghai'` 写死；存储仍存 ISO 瞬时，只在展示/导出时转上海时间。

## 改动后必须跑通的关卡
```bash
cd ~/工程实例/wanspilot-docker
npm test --prefix content        # verify/tests/*.test.mjs，node:test，当前 93 项
npm run check --prefix content   # node --check 覆盖全部 server/web 入口
WP_CHROME_PATH=~/opt/chrome-linux64/chrome npm run test:browser --prefix content
```
CI 是 `.github/workflows/docker.yml`：tag `v*` 或推 main → `npm ci` → `npm test` → `npm run check` → buildx 多架构推 `ghcr.io/wans-bot/wanspilot`（配了 `DOCKERHUB_USERNAME`/`DOCKERHUB_TOKEN` 才镜像到 `wansbot/wanspilot`）。测试不过不要推 tag。

## 代码放哪儿
- 新逻辑超过约 300 行就不要继续塞进 `app.js`：按现有先例拆纯模型模块（`calendar-model.js`、`automation-model.js`、`featured-model.js`），并在 `content/package.json` 的 `check` 脚本里登记新文件。
- 后端按职责分文件：`sources.mjs` 资源搜索、`indexers.mjs` Torznab/RSS、`engine.mjs` 任务编排、`subscriptions.mjs` 订阅追更、`organizer.mjs` 归档整理。`index.mjs` 只管路由与响应，不放业务逻辑。
- 持久化模块保持 `init*()` / `flush*()` 成对模式写入 `/data`，重启后能恢复；新增持久化文件沿用同一模式。

## 测试惯例（照抄现有风格）
- `verify/tests/*.test.mjs` 用 `node:test` + `node:assert/strict`，测试内用独立临时目录（`WP_DATA_DIR` / `WP_CACHE_DIR` / `WP_DOWNLOAD_DIR`），**绝不碰真实 NAS、绝不提交真实下载**。
- `verify/browser-smoke.mjs` 用 fixture API 起真实服务 + puppeteer-core，截图落 `verify/<feature>-vN/`。

## 部署事实（写文档 / 答疑时照这个说）
- 镜像 `ghcr.io/wans-bot/wanspilot:latest`，linux/amd64 + linux/arm64。
- `compose.yml` 走 bridge 网络；`compose.nas.yml` 是绿联 NAS 的 host 网络写法。`127.0.0.1:8585` 只有在 `network_mode: host` 且 qB 同机时成立；普通 bridge 下必须填 NAS 局域网 IP，设置页会直接拒绝回环地址。
- 首次登录：`docker exec wanspilot cat /data/access-token`，或 `WP_ACCESS_TOKEN`（≥16 字符）。
- 版本号同步 `content/package.json`、`content/version.json`，并在 `README.md` 顶部 changelog 段落补一条中文更新说明。

## 硬规则
- 时间一律上海时区（UTC+8），导出用 `YYYY-MM-DD HH:mm:ss`，不写带 `Z` 的 ISO。
- 界面不许出现彩色边条、单侧色条、inset 假色条（根目录 `AGENTS.md`）。
- 不打印、不写入任何 token / 密码 / 真实 API Key；日志里的密钥用 `redact()` 过滤。
