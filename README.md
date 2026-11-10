# wanspilot

自托管的影视发现 + 下载编排工具。**自己不跑 BT 引擎**：挑片、订阅、搜索在 wanspilot 里完成，实际下载交给你自己 NAS 上的 qBittorrent。

- 影视墙：TMDB 热门/高分/剧集，海报墙 + 详情页
- 资源搜索：多索引源聚合，按清晰度、做种数、体积筛选
- 订阅追更：剧集更新后自动找资源、判断是否值得洗版
- 下载：把磁力/种子提交给 qBittorrent，进度、速度、暂停恢复都在 wanspilot 里看
- 整理：下完后按 `片名 (年份)/` 归档，可选写 .nfo 与海报给 Jellyfin / Emby

镜像：`ghcr.io/wans-bot/wanspilot:latest`（linux/amd64、linux/arm64）。

## 快速开始

前提：已经装好 qBittorrent，Web UI 能打开，且日志里没有 "Web UI: Failed to listen"。

```bash
mkdir -p /volume1/docker/wanspilot && cd /volume1/docker/wanspilot
curl -O https://raw.githubusercontent.com/Wans-bot/wanspilot/main/compose.yml
# 改里面的 WP_QB_URL 与下载目录映射
docker compose up -d
```

打开 `http://<NAS-IP>:3000`，进「设置」填写 TMDB API Key，点「测试 TMDB」。

### qB 用 host 网络时

qB 容器如果是 `network_mode: host`（绿联、群晖上很常见），wanspilot 也建议用 host 网络，
这样能直接走 `http://127.0.0.1:<qB端口>`，利用 qB 的「本地主机跳过认证」，不用配账号密码：

```yaml
services:
  wanspilot:
    image: ghcr.io/wans-bot/wanspilot:latest
    network_mode: host          # 去掉 ports:
    environment:
      WP_PORT: 3000
      WP_QB_URL: http://127.0.0.1:8585
      WP_QB_SAVE_PATH: /video
      WP_QB_LOCAL_PATH: /video
    volumes:
      - ./data:/data
      - /volume1/video:/video
```

## 配置

| 变量 | 说明 |
|---|---|
| `WP_QB_URL` | qBittorrent Web UI 地址，如 `http://192.168.1.10:8080`。留空则不启用下载 |
| `WP_QB_USERNAME` / `WP_QB_PASSWORD` | qB 账号。qB 开了「本地主机跳过认证」时留空即可 |
| `WP_QB_SAVE_PATH` | 传给 `torrents/add` 的 savepath，**qB 视角**的路径，如 `/downloads` |
| `WP_QB_LOCAL_PATH` | 同一目录在 **wanspilot 容器里**的挂载路径。留空则不做自动整理 |
| `WP_QB_CATEGORY` | 给任务打的分类名，默认 `wanspilot` |
| `WP_TMDB_API_KEY` | 可选，预置 TMDB Key，省得进设置页填 |
| `PUID` / `PGID` | 容器内运行用户，默认 1000:1000 |

### 目录怎么对

两个路径要指向**宿主机同一个目录**：

```
宿主机:  /volume1/downloads
qB 容器: /downloads          ← qB 的保存目录（WP_QB_SAVE_PATH 填这个）
wanspilot: /downloads        ← 同样挂进来（WP_QB_LOCAL_PATH 填这个）
```

路径一致时，qB 返回的文件相对路径在 wanspilot 里能直接读到，整理才有效。两边路径不同也能下载，只是自动整理会跳过并说明原因。

不想让 wanspilot 碰文件？只填 `WP_QB_SAVE_PATH`，`WP_QB_LOCAL_PATH` 留空，下载与进度照样可用。

## 数据

| 容器路径 | 内容 |
|---|---|
| `/data` | 设置、任务记录、订阅、日志。**唯一必须持久化的卷** |
| `/downloads` | 可选，与 qB 共享的下载目录 |
| `/cache` | 海报缓存，可丢 |

## 从源码构建

```bash
docker buildx build --platform linux/amd64,linux/arm64 -t <你的账号>/wanspilot:latest --push .
```

或者 push 一个 `v*` tag，GitHub Actions（`.github/workflows/docker.yml`）会自动构建双架构并推到 GHCR，不需要任何 secret。要再镜像一份到 Docker Hub，加两个仓库 secret：`DOCKERHUB_USERNAME`、`DOCKERHUB_TOKEN`。

本地开发：

```bash
cd content
npm ci --omit=dev
WP_DATA_DIR=./.dev/data WP_DOWNLOAD_DIR=./.dev/downloads sh entry.sh
```

## 常见问题

**设置页提示「未配置 qBittorrent」** — 填地址并保存；点「测试 qB 连接」看具体报错。qB 5.0 起设置项在「选项 → Web UI」。

**任务一直「获取元数据」** — 磁力没有被 qB 里的 DHT/tracker 找到。先在 qB 里确认这个种子能下载，再回来看。

**加任务返回 403** — qB 的「Web UI → 认证」里打开了「对本地主机跳过认证」但实际不在同一台机器上时，需要填用户名密码；或反过来，把 wanspilot 的出口 IP 加进白名单。

**剩余空间显示 0** — qB 还没上报 `free_space_on_disk`，等一轮轮询（2 秒）；若一直 0，说明 qB 版本太老，忽略即可，不影响下载。

**自动整理没动文件** — `WP_QB_LOCAL_PATH` 留空，或该路径在容器里不可读。看日志 `[organize]` 行给出的 skipped 原因。

## 许可

本仓库只是把 wanspilot 打包成 Docker 镜像，不含第三方 BT 引擎。
