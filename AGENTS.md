# Design constraints

- Do not use decorative colored edge strips anywhere in this project. This is an explicit user preference across all their projects.
- Do not use single-sided colored borders, title accent bars, or inset shadows that simulate edge strips on cards, navigation, alerts, or sections.
- Use spacing, neutral borders, text, icons, and status labels for hierarchy and state. Keep functional progress indicators and accessible focus indicators.

# Project facts

- Node 后端只用内置 `http`，无框架、无 TypeScript、无打包；前端是浏览器直接加载的 ES 模块，同样没有构建步骤。
- 运行时依赖只有 `fast-xml-parser`、`undici`。新增依赖需要充分理由（镜像体积与启动速度是产品特性）。
- 时间一律上海时区：`content/web/time.js` 是唯一格式化入口，存储保持 ISO 瞬时。
- 后端按职责分文件，`content/server/index.mjs` 只做路由与响应；前端新逻辑不要再堆进 `app.js`，按 `*-model.js` 先例拆分。

# Commands

```bash
npm test --prefix content        # node:test 回归套件
npm run check --prefix content   # node --check 全部 server/web 入口
WP_CHROME_PATH=~/opt/chrome-linux64/chrome npm run test:browser --prefix content
```

# Skills

项目技能在 `.pi/skills/`，需要时用 `/skill:名字` 显式调起：

- `wanspilot-dev` — 技术栈基线、测试与发布关卡、NAS 部署事实
- `wanspilot-api` — 新增/修改 `/api` 端点必须做全的五步（路由、认证、响应、API.md、测试）
- `wanspilot-ui` — 前端结构、CSS 分层、无彩色边条禁令、状态矩阵、浏览器验收
