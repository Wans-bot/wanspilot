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

截图
- `tasks-live.png` — 任务页实机（真实下载 Sintel）
- `settings-live.png` — 设置页实机（qB 已连接、剩余空间 22.9 TB）

未验证/已知限制
- TMDB 未配置 Key（提示「先填写 TMDB API Key」），影视墙与搜索未实测
- 自动整理（`autoOrganize`）默认关闭，未在该 NAS 上开启验证
- 双架构镜像由 GitHub Actions 产出（amd64+arm64），本机只验证了 amd64（NAS 是 x86_64）
