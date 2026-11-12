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

1. 打开 `http://<NAS 局域网 IP>:3000`，执行 `docker exec wanspilot cat /data/access-token` 读取首次自动生成的访问令牌并登录；
2. 进「设置」→「qBittorrent」，填 **地址、用户名、密码**（以及可选的保存目录），点「测试 qB 连接」，通过后保存；
3. 按需填 TMDB API Key，点「测试 TMDB」。

地址要填 NAS 的**局域网 IP + qB WebUI 端口**，例如 `http://192.168.1.10:<端口号>`。
不要填 `127.0.0.1` 或 `localhost`：容器里的回环地址指向 wanspilot 自己，永远连不到 NAS 上的 qB，
设置页和接口都会直接拒绝这种地址。

## 配置

设置全部在网页「设置」里填写，保存在 `/data/settings.json`，环境变量只剩这几个：

| 变量 | 说明 |
| --- | --- |
| `PUID` / `PGID` | 容器内运行用户，默认 1000:1000 |
| `WP_ACCESS_TOKEN` | 可选，指定至少 16 字符的访问令牌；未指定时自动生成并持久化到 `/data/access-token` |
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

## 账号密码登录（绿联 NAS 简化部署）

使用 `compose.nas.yml` 即可直接拉取已发布镜像，无需下载源码。修改 YAML 中 `WP_USERNAME` 和 `WP_PASSWORD`（密码至少 8 个字符），执行 `docker compose -f compose.nas.yml up -d`。NAS 固定配置不显式设置 `PUID` / `PGID`，使用镜像默认运行用户；媒体目录按实际情况修改。

后续固定使用 `ghcr.io/wans-bot/wanspilot:latest`。更新时保留原有 YAML、账号密码和数据目录，在部署目录执行：

```bash
docker compose -f compose.nas.yml pull
docker compose -f compose.nas.yml up -d
```

`latest` 在每次成功发布后更新；已有容器不会自动升级，单纯重启也不会拉取新镜像。绿联 Docker 界面中可拉取最新镜像后重新创建容器，继续使用原来的挂载路径。

配置账号密码后，登录页自动显示账号和密码输入框，不再使用令牌登录。只配置其中一项或密码过短会拒绝启动。修改凭据后重新创建容器，旧会话自动失效。未配置账号密码时保留原有令牌模式；账号模式若需自动化 Bearer 访问，另行配置 `WP_ACCESS_TOKEN`。

## 1.1.2 手机适配与 qB 版本兼容

- 手机与平板统一使用 860px 导航断点；搜索和资源筛选折叠，详情海报与片名并排，任务统计更紧凑。
- 手机设置使用分区下拉选择，保存按钮随表单滚动，避免遮挡输入；弹窗隔离背景操作，适配短屏、横屏和安全区域。
- 深浅主题同步适配，表单输入避免 iOS 自动放大。桌面仍保留完整筛选和设置导航。
- qBittorrent 4.1+ / 5.x 自动识别 Web API v2，适配暂停/恢复与停止/启动接口；4.0.4 及更早版本按旧 API 探测连接。
- 同时兼容 SID / QBT_SID 会话和免认证模式。缺少可选磁盘统计时显示未知，不阻止连接；实际剩余空间为 0 时保留 0。
- 3.2 系列旧 API 的磁力添加不支持指定目录、分类或暂停添加，这些操作会明确提示升级。兼容性基于官方协议与模拟服务回归，未对所有历史版本逐一实机测试，也不保证非官方修改版。

## 1.1.1 日历与极简登录

- 追剧日历支持桌面月历 / 时间线切换；手机自动显示按天分组的时间线。
- 同日同季多集合并卡片，显示真实集号范围与部分完成进度；繁忙日期可展开，点击日期查看逐集详情并寻找资源。
- 可按剧集、下载状态筛选，支持月份选择、回到本月和刷新。未来未播出集数不计入待补集；日期按服务端本地时区判断。
- TMDB 部分失败显示不完整提示，不再将失败的空结果缓存 6 小时；快速切月不会让旧请求覆盖新月份。
- 登录页精简为品牌、账号密码和登录按钮，支持密码显示 / 隐藏；移除顶栏 Logo 的 CSS 白色底板，保留图片原有透明通道。

## 1.1.0 的安全与交互约定

- 深色界面采用影院式首页、精选背景和海报墙，浅色主题与手机底部导航同步适配。
- 设置表单保留未保存草稿；后台自检不会覆盖输入，测试连接使用当前填写的值。
- TMDB Key 与 qB 密码不会通过设置接口回显；输入留空保留原值，勾选明确的清除选项才删除。
- 登录 Cookie 有效期 7 天，采用 HttpOnly 和 SameSite=Strict。自动化使用 `Authorization: Bearer <访问令牌>`。退出仅清除当前浏览器 Cookie；更换令牌并重启服务会使原有会话失效。
- 整理前可以先预览。正式整理优先建立硬链接；跨文件系统时复制，始终保留 qB 原文件和做种路径。跨盘复制需要额外空间，样本文件只跳过、不删除。
- 海报缓存按 512 MiB / 30 天预算定期清理；运行日志自动轮转。请继续备份 `/data`。
- 失败任务保留原因并支持重试；订阅区分下载中与已完成，避免提交失败却错误标为已下载。

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

开发验收（使用隔离数据，不提交真实下载）：

```bash
npm ci --prefix content
npm test --prefix content
npm run check --prefix content
# 需本机安装 Chromium，或通过 WP_CHROME_PATH 指定可执行文件
npm run test:browser --prefix content
```

浏览器验收使用示例接口数据，截图和结果写到 `verify/cinema-v3/`。设计参考 Seerr 的影视发现层级、Jellyfin Web 的主题体系，保留 WansPilot 品牌与原生页面结构。

## 常见问题

**设置页提示「未配置 qBittorrent」** — 填地址并保存；点「测试 qB 连接」看具体报错。qB 5.0 起设置项在「选项 → Web UI」。

**「测试 qB 连接」连不上** — 先看地址：必须是 `http://<NAS 局域网 IP>:<qB WebUI 端口>`，填 `127.0.0.1` / `localhost` 会被直接拒绝（容器里的回环地址是 wanspilot 自己）。地址对但仍失败时，依次确认：qB 的 WebUI 监听在 `0.0.0.0` 而不是只绑 `127.0.0.1`、容器能访问到该端口（`docker compose exec wanspilot node -e "fetch('http://<IP>:<端口>').then(r=>console.log(r.status)).catch(e=>console.log(e.message))"`）、以及账号密码正确（qB 连续失败会短暂封禁来源 IP，等几分钟再试）。

**任务一直「获取元数据」** — 磁力没有被 qB 里的 DHT/tracker 找到。先在 qB 里确认这个种子能下载，再回来看。

**加任务返回 403** — qB 的「Web UI → 认证」里打开了「对本地主机跳过认证」但实际不在同一台机器上时，需要填用户名密码；或反过来，把 wanspilot 的出口 IP 加进白名单。

**剩余空间显示未知或 0** — 未上报的空间显示为未知；真实剩余空间为 0 或配额用尽时会阻止新增下载。请确认 qB 所在磁盘空间，并检查配额。

**自动整理没动文件** — 设置页「本地挂载路径」留空，或该路径在容器里不可读（compose 里没挂下载目录）。看日志 `[organize]` 行给出的 skipped 原因。

## 许可

本仓库只是把 wanspilot 打包成 Docker 镜像，不含第三方 BT 引擎。
