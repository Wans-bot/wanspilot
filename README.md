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
docker compose up -d
```

**部署时不用填 qB 的地址和账号**，容器起来后：

1. 打开 `http://<NAS 局域网 IP>:3000`；
2. 进「设置」→「qBittorrent」，填 **地址、用户名、密码**（以及可选的保存目录），点「测试 qB 连接」，通过后保存；
3. 按需填 TMDB API Key，点「测试 TMDB」。

地址要填 NAS 的**局域网 IP + qB WebUI 端口**，例如 `http://192.168.31.119:8585`。
不要填 `127.0.0.1` 或 `localhost`：容器里的回环地址指向 wanspilot 自己，永远连不到 NAS 上的 qB，
设置页和接口都会直接拒绝这种地址。

## 配置

设置全部在网页「设置」里填写，保存在 `/data/settings.json`，环境变量只剩这几个：

| 变量 | 说明 |
| --- | --- |
| `PUID` / `PGID` | 容器内运行用户，默认 1000:1000 |
| `WP_TMDB_API_KEY` | 可选，预置 TMDB Key，省得进设置页填 |
| **qBittorrent 地址 / 用户名 / 密码 / 保存目录 / 本地挂载路径 / 分类** | **不在 compose 里配，部署后在设置页填** |

两个路径要指向**宿主机同一个目录**：

```text
宿主机:  /volume1/downloads
qB 容器: /downloads          ← qB 的保存目录（设置页「保存目录（qB 视角）」填这个）
wanspilot: /downloads        ← 同样挂进来（设置页「本地挂载路径（本容器视角）」填这个）
```

路径一致时，qB 返回的文件相对路径在 wanspilot 里能直接读到，整理才有效。两边路径不同也能下载，只是自动整理会跳过并说明原因。

不想让 wanspilot 碰文件？只填「保存目录（qB 视角）」，「本地挂载路径」留空，下载与进度照样可用。

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

**「测试 qB 连接」连不上** — 先看地址：必须是 `http://<NAS 局域网 IP>:<qB WebUI 端口>`，填 `127.0.0.1` / `localhost` 会被直接拒绝（容器里的回环地址是 wanspilot 自己）。地址对但仍失败时，依次确认：qB 的 WebUI 监听在 `0.0.0.0` 而不是只绑 `127.0.0.1`、容器能访问到该端口（`docker compose exec wanspilot node -e "fetch('http://<IP>:<端口>').then(r=>console.log(r.status)).catch(e=>console.log(e.message))"`）、以及账号密码正确（qB 连续失败会短暂封禁来源 IP，等几分钟再试）。

**任务一直「获取元数据」** — 磁力没有被 qB 里的 DHT/tracker 找到。先在 qB 里确认这个种子能下载，再回来看。

**加任务返回 403** — qB 的「Web UI → 认证」里打开了「对本地主机跳过认证」但实际不在同一台机器上时，需要填用户名密码；或反过来，把 wanspilot 的出口 IP 加进白名单。

**剩余空间显示 0** — qB 还没上报 `free_space_on_disk`，等一轮轮询（2 秒）；若一直 0，说明 qB 版本太老，忽略即可，不影响下载。

**自动整理没动文件** — 设置页「本地挂载路径」留空，或该路径在容器里不可读（compose 里没挂下载目录）。看日志 `[organize]` 行给出的 skipped 原因。

## 许可

本仓库只是把 wanspilot 打包成 Docker 镜像，不含第三方 BT 引擎。
