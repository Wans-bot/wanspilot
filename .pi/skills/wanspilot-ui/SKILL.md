---
name: wanspilot-ui
description: WansPilot 前端约定——无框架 ES 模块结构、CSS 分层、无彩色边条禁令、状态矩阵、移动端断点、浏览器验收与截图证据。改页面、调样式、做视觉打磨时使用。
---

# WansPilot 前端

## 结构
- `content/web/index.html` 单页；`app.js` 负责视图与交互；纯逻辑抽到 `*-model.js`（`calendar-model.js`、`automation-model.js`、`featured-model.js`）；时间只用 `time.js`。
- CSS 分层：`styles.css`（基础/布局）、`cinema.css`（影视墙主视觉）、`mobile.css`（移动端覆盖）、`opening.css`（启动动画）。新样式放对应层，不要堆在 `styles.css` 末尾。
- 图标用 `content/web/vendor/lucide-icons.js` 里的内联 lucide，不要手写 SVG，也不要拿 emoji 当图标。

## 设计硬规则（违反即打回）
- **禁止彩色边条**：不写 `border-left|right|top|bottom: Npx solid <彩色>`、不写 `box-shadow: inset Npx 0 0 <彩色>`，不要左侧竖色条或标题强调块。
- 需要强调时用：整圈边框换色、浅色背景块、圆点或图标、文字颜色、圆角块、pill 边框。
- 语义色（成功绿 / 警告黄 / 错误红）只用在文字、图标、pill 边框、整圈边框上。
- 层级靠间距、中性边框、字号字重、状态文案，不靠颜色条。
- 改完自查：`grep -nE "border-(left|right|top|bottom):[^;]*solid|inset [0-9]+px 0 0" content/web/*.css`，命中就改掉。

## 状态矩阵
每个列表、卡片、表单都要有四种状态：加载骨架、空态（一句可操作文案 + 入口按钮）、错误态（原因 + 重试）、成功态。照首页 / 订阅页现有实现来写，不要只写成功分支。

## 时间
展示只用 `time.js` 的 `shanghaiDate` / `shanghaiTime` / `shanghaiDateTime`；不写 `toLocaleString()`（跟着浏览器时区跑），不对 ISO 字符串做字符串截断。

## 验收
```bash
WP_CHROME_PATH=~/opt/chrome-linux64/chrome npm run test:browser --prefix content
```
- 截图落 `verify/<feature>-vN/`，桌面和手机各拍关键页，随改动一起提交。
- 移动端断点沿用 `mobile.css` 里已有的，不新增自定义宽度。
- 验收截图必须来自「模型/qB/TMDB 已配置好」的可用状态，不要留空壳界面当证据。
