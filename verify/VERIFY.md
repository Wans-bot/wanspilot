# 实机验收记录 — 绿联 UGOS Pro（2026-11-11）

硬件/环境
- NAS：绿联 UGOS Pro，`192.168.31.119`，Linux 6.18.15，x86_64，Docker 29.6.2
- 已有服务：qBittorrent（`linuxserver/qbittorrent`，`network_mode: host`，WebUI `8585`，
  保存目录 `/video` ← 宿主机 `/volume1/video`，`WebUI\AuthSubnetWhitelistEnabled=true`、`LocalHostAuth=false`）
- 部署目录：`/volume1/docker/wanspilot`，数据卷 `./data:/data`，媒体卷 `/volume1/video:/video`

部署方式
```yaml
services:
  wanspilot:
    image: ghcr.io/wans-bot/wanspilot:latest
    container_name: wanspilot
    restart: unless-stopped
    network_mode: host          # 与 qB 同网络，走 127.0.0.1 免认证
    environment:
      TZ: Asia/Shanghai
      PUID: 0
      PGID: 0
      WP_PORT: 3000
      WP_QB_URL: http://127.0.0.1:8585
      WP_QB_SAVE_PATH: /video
      WP_QB_LOCAL_PATH: /video
      WP_QB_CATEGORY: wanspilot
    volumes:
      - ./data:/data
      - /volume1/video:/video
```

验收结果

| 检查项 | 结果 |
|---|---|
| 镜像拉取 | `ghcr.io/wans-bot/wanspilot:latest` 拉取成功，digest `sha256:3b1d398de582…`，1m6s |
| 容器状态 | `Up (healthy)`，healthcheck 通过 |
| `/api/health` | `{"status":"ok","version":"1.0.0"}` |
| qB 连通（页面「测试 qB 连接」） | `{"ok":true,"message":"已连上 qBittorrent v5.2.3"}` |
| 剩余空间来自 qB | `{"freeBytes":25201029165056,…, "source":"qbittorrent"}`（22.9 TB） |
| 真实磁力提交 | Big Buck Bunny → `downloading 2.4% 412 KB/s`，出现在 qB 里 |
| 暂停 / 继续 | `paused, rateDown=0` → `downloading` |
| 删除任务（含文件） | 200，列表归零 |
| 任务页实时刷新 | Sintel 下载中 10.5%，`12.9 MB / 123 MB`，`↓319 KB/s`，路径 `/video/Sintel` |
| 设置页自检 | 下载目录 ✓ `/video 可写`、qBittorrent ✓ `已配置 http://127.0.0.1:8585`、下载引擎 ✓ 就绪、索引源均可用 |
| TMDB Key | 已填入（32 位 v3 key），`/api/tmdb/search?q=matrix` 返回《黑客帝国》1999 |
| 影视墙 | 热门电影/剧集/动漫/高分榜全部有数据，海报经 `/api/image` 代理加载，1440×1000 截图无破图 |
| 界面 logo | 顶栏 W 标 + 「WansPilot」正常显示，`/logo.png`、`/logo-mark.png` 均 200 image/png |

截图
- `home-live.png` — 影视墙实机（TMDB 数据 + 海报 + logo）
- `tasks-live.png` — 任务页实机（真实下载 Sintel）
- `settings-live.png` — 设置页实机（qB 已连接、剩余空间 22.9 TB）

未验证/已知限制
- 自动整理（`autoOrganize`）默认关闭，未在该 NAS 上开启验证
- 双架构镜像由 GitHub Actions 产出（amd64+arm64），本机只验证了 amd64（NAS 是 x86_64）

## v2 界面改动验收（本地实例，2026-11-11）

改动内容
- 设置页从「一列到底」改成 4 张分组卡片（TMDB / qBittorrent / 筛选与订阅 / 下载与整理），底部保存条在窄屏吸底。
- 去掉 Docker 版对懒猫平台网盘选择器的依赖（`vendor/lzc-file-pickers.umd.js` 在 Docker 版不存在，之前每次加载都 404）。
- 移动端影视墙缩小卡片宽度（42vw → 36vw），第三条卡片从只露 14px 变成露约 54px；卡片标题固定两行高度，「年份 · 类型」在整排内对齐。
- 开屏动画补上 WansPilot 字标。

验证环境
- 本机 `content/server/index.mjs` 起在 `127.0.0.1:3010`；本机**不能**直连 `api.themoviedb.org`，所以 `/api/tmdb/home`、`/api/tmdb/discover`、`/api/settings` 用 NAS 真实响应的副本打桩（密钥已改为占位值），海报仍走真实的 `/api/image` 代理。**不是** NAS 实机截图。

验证结果

| 检查项 | 结果 |
|---|---|
| 控制台 | 去掉 lzc 脚本后无 404、无 `SyntaxError`，加载干净 |
| 设置页（桌面 1440×1000） | 4 张卡片 + 右栏自检结果，层次清楚；保存/重新载入/运行状况在一条保存条里 |
| 设置页（手机 390×844） | 整页 4051px，顺序为 4 张卡 → 自检结果 → 系统信息 → 运行日志；保存条吸在标签栏上方，3 个按钮一行不换行 |
| 影视墙（桌面） | 5 个板块海报正常，卡片底部「年份 · 类型」对齐 |
| 影视墙（手机） | 2 张整卡 + 第 3 张露约 54px，标题换行不影响底部对齐 |
| 开屏动画 | 2.5s 画面 = 蓝色 W 标 + WansPilot 字标 + 「电影 · 电视 · 一站检索」 |
| 浏览器页 | 筛选行（类型/风格/语种/年份/评分/排序）单行排布，结果网格 8 列对齐 |

截图
- `settings-desktop-v2.png` — 设置页桌面（本地打桩）
- `settings-mobile-v2.png` — 设置页手机首屏（本地打桩）
- `home-mobile-v2.png` — 影视墙手机（本地打桩）
- `opening-desktop-v2.png` — 开屏动画 2.5s（本地）

未验证
- 本轮改动尚未部署到 NAS，NAS 上仍是 v1；要用新界面需要在 NAS 上重新 `docker compose pull && up -d`。
