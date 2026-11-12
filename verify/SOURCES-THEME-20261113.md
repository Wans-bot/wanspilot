# 索引源扩容与主题切换改造（2026-11-13）

## 需求

1. 资源太少，增加更多 BT 站点（尤其是大型站）。
2. 黑白主题切换的两个图标合并成一个按钮。
3. 切换主题时线性过渡，不要瞬间跳变。

## 改动

### 新增内置索引源（4 个）

| id | 站点 | 返回 | 代理 | 说明 |
|---|---|---|---|---|
| `dmhy` | 动漫花园 | RSS，`.torrent` 链接 | 否 | 中文动漫最大站，种子文件里才有 info hash，走 release 机制 |
| `acgrip` | acg.rip | RSS，`.torrent` 链接 | 否 | 中文动漫与日剧 |
| `bt4g` | BT4G | RSS，magnet | 是 | 聚合站，覆盖 1337x / LimeTorrents / The Pirate Bay 等大站 |
| `knaben` | Knaben | JSON API（POST） | 是 | 聚合上百个站 |

- 解析逻辑抽到新模块 `content/server/feed.mjs`（纯函数，可单测）：`parseTorrentFeed` / `parseMagnetFeed` / `parseKnaben` / `sizeFromText`。
- `content/server/sources.mjs` 新增 `releaseFeedItems` / `hashFeedItems` 两个归一化帮手：只有 `.torrent` 链接的源走 release 机制；做种数缺失时标 `seedersUnknown`，不按 0 参与筛选。
- 动漫花园的 `<link>` 是详情页，只认 `.torrent` 地址，避免把 HTML 当种子下载。
- 内置源列表：9 个（TPB、Torrents-CSV、Mikan、动漫花园、acg.rip、Nyaa、YTS、BT4G、Knaben）；其中 Nyaa / YTS / BT4G / Knaben 需要配置「网络代理」才启用。
- 移除「常用预设」里的动漫花园、acg.rip 两项（已是内置源，重复添加会产生重复结果）。
- `builtinSourceIds()` 导出给测试与设置页使用；`check` 脚本加入 `server/feed.mjs`。

### 主题切换

- `content/web/index.html`：双图标滑动开关换成单个 `.icon-btn`，图标显示当前主题（暗色显示月亮、亮色显示太阳），`aria-label`/`title` 说明「当前 X 主题，点击切换到 Y 主题」。
- `content/web/app.js`：`applyTheme` 填充单个图标；新增 `startThemeFade(root)`，切换时给 `<html>` 加 `theme-fade`，520ms 后摘除；`prefers-reduced-motion` 下不启用。
- `content/web/styles.css`：删除 `.themebtn__track/__side/__thumb` 全部样式；新增 `theme-fade` 规则，对 `background-color / border-color / color / fill / stroke / opacity` 做 0.4s 线性过渡，并保留 reduced-motion 覆盖。
- `content/web/mobile.css`：同步删除旧开关的手机端规则。

## 验证

- `npm run check --prefix content`：通过（新增 `server/feed.mjs` 语法检查）。
- `npm test --prefix content`：103/103 通过，含新增 `verify/tests/feed.test.mjs`（四种返回格式解析 + 内置源清单）。
- `WP_CHROME_PATH=/home/wans/opt/chrome-linux64/chrome npm run test:browser --prefix content`：88 项全过，无页面 JS 异常；新增断言：切换时 `html.theme-fade` 存在、`body` 过渡时长 0.4s、主题按钮只有一个图标、700ms 后 `theme-fade` 已摘除。
- 截图：`verify/ui-sources-20261113/`（资源页、首页、手机各断点等）。

## 已知限制

- 本机（沙箱）到 `share.dmhy.org`、`bt4gprx.com`、`knaben.eu` 均不可达（curl 28 超时），因此这四个新源只做了离线解析测试与离线注册表测试，真实抓取需在配有代理的部署环境复核。不可达时资源页会按源显示错误，不会影响其他源出结果。
- 1337x / LimeTorrents / TorrentGalaxy 没有公开 API，抓 HTML 易碎，未单独实现；BT4G 与 Knaben 已覆盖这些站的种子。
