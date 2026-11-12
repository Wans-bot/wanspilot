# wanspilot 内部 API 契约

前端与后端之间唯一的接口约定。后端实现在 `content/server/`，前端实现在 `content/web/`。
全部接口同源，路径前缀 `/api`。除 `/api/health`、`/api/auth/status`、`/api/auth/login` 外均需访问令牌会话或 Bearer 认证。

统一约定：

- 请求与响应都是 JSON，除非特别说明。请求体为 `application/json`。
- 失败响应沿用 HTTP 语义，正文形如 `{ "error": "中文错误信息" }`。
- 时间字段一律 ISO 8601 字符串。
- 字节数字段一律整数，单位 byte。

## 0. 访问认证

- `GET /api/auth/status`：返回 `{ "authenticated": true | false, "required": true, "mode": "password" | "token" }`。
- `POST /api/auth/login`：账号模式请求 `{ "username": "账号", "password": "密码" }`，令牌模式请求 `{ "token": "访问令牌" }`，成功签发 7 天 HttpOnly、SameSite=Strict Cookie；失败返回 401，单 IP 15 分钟内 10 次失败后返回 429。
- `POST /api/auth/logout`：清除当前浏览器 Cookie，不集中撤销其他会话。令牌更换并重启后旧会话失效。
- 自动化请求可带 `Authorization: Bearer <token>`。跨站变更请求被拒绝（403）；未登录的受保护接口返回 401。

## 1. 健康与系统

### `GET /api/health`
不鉴权，供容器健康检查。
```json
{ "status": "ok", "version": "1.0.0-1" }
```

### `GET /api/system`
```json
{
  "version": "1.0.0-1",
  "nodeVersion": "v22.x.x",
  "dataDir": "/data",
  "downloadDir": "/downloads",
  "downloadDirRelative": "",
  "downloadDirWritable": true,
  "freeBytes": 123456789012,
  "uptimeSeconds": 1234,
  "engineReady": true
}
```

## 2. 设置

### `GET /api/settings`
```json
{
  "tmdbApiKeySet": false,
  "tmdbApiBase": "https://api.tmdb.org/3",
  "tmdbImageBase": "https://tmdb-image-prod.b-cdn.net/t/p",
  "proxy": "",
  "downloadDir": "",
  "qualityPreference": "1080p",
  "minSeeders": 5,
  "maxSizeGB": 30,
  "checkIntervalMinutes": 60,
  "autoDownload": true,
  "theme": "dark",
  "quotaGB": 0,
  "autoOrganize": false,
  "writeNfo": false,
  "deleteSamples": true,
  "qbUrl": "http://192.168.1.10:8080",
  "qbUsername": "",
  "qbPasswordSet": false,
  "qbSavePath": "/downloads",
  "qbLocalPath": "/downloads",
  "qbCategory": "wanspilot"
}
```

### `PUT /api/settings`
请求体是设置字段的任意子集，返回不含密钥的公开设置对象。`tmdbApiKeySet` / `qbPasswordSet` 为只读状态。
`tmdbApiKey`、`qbPassword` 传空字符串表示清空，未出现的键保持原值。写盘失败返回 507，内存恢复为上次成功保存的状态。

### `GET /api/settings/status`
「设置」页用来显示自检结果。
```json
{
  "tmdbKeySet": true,
  "tmdbOk": true,
  "tmdbMessage": "TMDB 连接正常",
  "tmdbImageOk": true,
  "tmdbImageMessage": "海报源连接正常",
  "downloadDirOk": true,
  "downloadDirMessage": "/downloads 可写（整理与配额检查用）",
  "engineReady": true,
  "qbUrl": "http://192.168.1.10:8080",
  "sources": [
    { "id": "apibay", "name": "The Pirate Bay", "ok": true, "latencyMs": 420, "message": "" },
    { "id": "torrents-csv", "name": "Torrents-CSV", "ok": true, "latencyMs": 310, "message": "" }
  ]
}
```

### `POST /api/settings/test`
请求体 `{ "kind": "tmdb" | "image" | "proxy" | "source" | "qb", "id": "apibay" }`，
强制重测并返回与 `/api/settings/status` 同形的结果。TMDB / image / proxy 测试可带当前草稿 `tmdbApiKey`、`tmdbApiBase`、`tmdbImageBase`、`proxy`，仅用于本次测试，不保存。

`kind: "qb"` 时请求体额外带 `qbUrl` / `qbUsername` / `qbPassword`（不传则用已保存的设置），
返回 `{ "ok": true, "message": "已连上 qBittorrent v5.0.3", "version": "...", "apiVersion": "2.11.2", "apiMode": "v2", "warnings": [] }`，
`apiMode` 为 `v2` 或 `legacy`；`warnings` 提示缺少可选统计等能力，核心任务接口正常时仍返回成功。
连不上时 `ok: false` 且 `message` 里说明是地址不通还是认证被拒（HTTP 状态码始终是 200）。

## 3. 影视资料（TMDB）

`type` 取值：`movie`、`tv`、`anime`。`anime` 在 TMDB 侧等价于 `tv` 加动画类型过滤。

### `GET /api/tmdb/home`
首页影视墙一次取回全部区块，减少请求数。
```json
{
  "blocks": [
    { "id": "movie-trending", "type": "movie", "title": "热门电影",
      "items": [ /* MediaCard */ ] },
    { "id": "tv-trending", "type": "tv", "title": "热门剧集", "items": [] },
    { "id": "anime-trending", "type": "anime", "title": "热门动漫", "items": [] },
    { "id": "movie-top", "type": "movie", "title": "高分电影", "items": [] },
    { "id": "tv-top", "type": "tv", "title": "高分剧集", "items": [] }
  ]
}
```

**MediaCard**
```json
{
  "id": 550,
  "type": "movie",
  "title": "搏击俱乐部",
  "originalTitle": "Fight Club",
  "year": "1999",
  "posterPath": "/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg",
  "backdropPath": "/hZkgoQYus5vegHoetLkCJzb17zJ.jpg",
  "voteAverage": 8.4,
  "overview": "……"
}
```

### `GET /api/tmdb/browse?type=movie|tv|anime&category=<key>&page=1`
`category` 取值：电影与剧集 `popular`、`top_rated`、`now_playing`（仅电影）、`upcoming`（仅电影）、
`airing_today`（仅剧集）、`on_the_air`（仅剧集）；动漫用 `popular`、`top_rated`、`on_the_air`。
返回 `{ "items": [MediaCard], "page": 1, "totalPages": 500 }`。

### `GET /api/tmdb/search?q=<关键词>&type=multi|movie|tv|anime&page=1`
返回 `{ "items": [MediaCard], "page": 1, "totalPages": 20 }`。
`type=multi` 时结果里 movie 与 tv 混排，以 `type` 字段区分。

### `GET /api/tmdb/detail?type=movie|tv&id=550`
```json
{
  "id": 550, "type": "movie",
  "title": "搏击俱乐部", "originalTitle": "Fight Club",
  "overview": "……", "tagline": "……",
  "posterPath": "/x.jpg", "backdropPath": "/y.jpg",
  "releaseDate": "1999-10-15", "year": "1999",
  "voteAverage": 8.4, "voteCount": 29000,
  "runtime": 139, "genres": ["剧情", "惊悚"],
  "status": "Released", "tmdbUrl": "https://www.themoviedb.org/movie/550",
  "imdbId": "tt0137523",
  "seasons": [
    { "seasonNumber": 1, "name": "第 1 季", "episodeCount": 9, "airDate": "2019-11-01", "posterPath": "/s1.jpg" }
  ],
  "numberOfEpisodes": 0,
  "numberOfSeasons": 0,
  "lastEpisode": { "season": 6, "episode": 4, "airDate": "2026-10-08" },
  "episodeRuntime": [50]
}
```
`seasons`、`numberOfEpisodes`、`lastEpisode` 仅对 `type=tv` 有意义。

### `GET /api/tmdb/season?type=tv&id=123&season=1`
```json
{
  "seasonNumber": 1, "name": "第 1 季", "airDate": "2019-11-01",
  "episodes": [
    { "episodeNumber": 1, "name": "第一集", "airDate": "2019-11-01",
      "stillPath": "/s.jpg", "overview": "……", "runtime": 50 }
  ]
}
```

### `GET /api/image?path=/x.jpg&size=w342`
返回图片二进制，`Content-Type` 为图片类型，`Cache-Control: public, max-age=604800`。
`size` 取值 `w92`、`w154`、`w185`、`w342`、`w500`、`w780`、`original`，缺省 `w342`。
后端按设置里的 `tmdbImageBase` 回源，并在 `/cache` 落地缓存；失败时返回 404 与占位图。
前端所有海报、剧照、背景图都必须走这个地址，不要直接引用外域。

## 4. 资源搜索

### `GET /api/resources?q=&type=&season=&episode=&year=&tmdbId=`
后端并发查询全部启用的索引源，合并去重后按得分排序。
```json
{
  "query": "Slow Horses S06",
  "sources": [
    { "id": "apibay", "name": "The Pirate Bay", "ok": true, "count": 12, "latencyMs": 420, "error": "" },
    { "id": "torrents-csv", "name": "Torrents-CSV", "ok": true, "count": 3, "latencyMs": 310, "error": "" }
  ],
  "items": [
    {
      "id": "apibay:abc123",
      "title": "Slow.Horses.S06E04.1080p.WEB.H264-CAKES",
      "indexer": "apibay",
      "indexerName": "The Pirate Bay",
      "infoHash": "abc123…",
      "magnet": "magnet:?xt=urn:btih:…",
      "sizeBytes": 2147483648,
      "seeders": 2468,
      "leechers": 120,
      "publishedAt": "2026-10-08T12:00:00.000Z",
      "resolution": "1080p",
      "codec": "H264",
      "sourceTag": "WEB",
      "isSeasonPack": false,
      "season": 6,
      "episode": 4,
      "episodeList": [4],
      "score": 86,
      "trust": 88,
      "trustLabel": "高"
    }
  ]
}
```

`trust` 是 0–100 的可信度分，`trustLabel` 是四档文字：`高`（85 以上）、`较高`（70–84）、
`一般`（55–69）、`低`（55 以下）。前端按这四档各自配色，并提供排序与筛选：排序取
`seeders`（做种最多）、`leechers`（下载最多）、`size`（体积最大）、`resolution`（清晰度最高）、
`trust`（可信度最高）；筛选取体积区间、做种数下限与可信度档位。`GET /api/resources` 的查询串
支持同样的参数，前端只做本地过滤与排序。

## 5. 下载任务

**TaskItem**
```json
{
  "id": "abc123…",
  "name": "Slow.Horses.S06E04.1080p.WEB.H264-CAKES",
  "magnet": "magnet:?xt=…",
  "sizeBytes": 2147483648,
  "downloadedBytes": 1073741824,
  "progress": 0.5,
  "state": "downloading",
  "rateDown": 1048576,
  "rateUp": 0,
  "peers": 42,
  "etaSeconds": 1200,
  "addedAt": "2026-10-14T08:00:00.000Z",
  "completedAt": null,
  "savePath": "/downloads/下载/wanspilot/Slow.Horses.S06E04…",
  "error": "",
  "files": [ { "path": "Slow.Horses.S06E04.mkv", "sizeBytes": 2147483648, "progress": 0.5 } ]
}
```
`state` 取值：`queued`、`fetching-metadata`、`downloading`、`seeding`、`paused`、`completed`、`error`。

### `GET /api/tasks`
```json
{ "items": [ /* TaskItem */ ],
  "stats": { "active": 2, "completed": 5, "rateDown": 1048576, "rateUp": 0,
             "totalSizeBytes": 10737418240 } }
```

### `POST /api/tasks`
请求体三选一：`{ "magnet": "magnet:?xt=…" }`、`{ "infoHash": "…" }`、
`{ "torrentBase64": "…" }`（前端读到的 .torrent 文件内容）。
返回 `{ "task": TaskItem }`。重复添加返回 409 与 `{ "error": "该任务已在下载列表中" }`。

### `GET /api/tasks/:id`
返回 `{ "task": TaskItem }`。

### `POST /api/tasks/:id/pause`、`POST /api/tasks/:id/resume`
返回 `{ "task": TaskItem }`。

### `DELETE /api/tasks/:id?deleteFiles=0`
`deleteFiles=1` 时同时删除已下载文件。返回 `{ "ok": true }`。

### `GET /api/tasks/events`
Server-Sent Events。每 2 秒推送一次 `data: {"items":[TaskItem],"stats":{…}}`。
前端断线后自行重连。

## 6. 订阅

**SubscriptionItem**
```json
{
  "id": "sub_ab12cd",
  "type": "tv",
  "tmdbId": 123,
  "title": "流人",
  "originalTitle": "Slow Horses",
  "posterPath": "/x.jpg",
  "year": "2022",
  "seasons": [6],
  "qualityPreference": "1080p",
  "minSeeders": 5,
  "maxSizeGB": 30,
  "autoDownload": true,
  "enabled": true,
  "createdAt": "2026-10-14T08:00:00.000Z",
  "lastCheckAt": "2026-10-14T09:00:00.000Z",
  "nextCheckAt": "2026-10-14T10:00:00.000Z",
  "lastMessage": "发现 1 个新剧集，已加入下载",
  "downloadedKeys": ["S06E01", "S06E02"],
  "state": "watching"
}
```
`state` 取值：`watching`（有更新在跟）、`idle`（已完结或无更新）、`paused`、`error`。
电影订阅的 `seasons` 为 `null`，`downloadedKeys` 用 `movie` 表示已下载。

### `GET /api/subscriptions`
`{ "items": [SubscriptionItem] }`

### `POST /api/subscriptions`
请求体 `{ "type": "movie"|"tv", "tmdbId": 123, "seasons": [6], "qualityPreference": "1080p",
"minSeeders": 5, "maxSizeGB": 30, "autoDownload": true }`。返回 `{ "item": SubscriptionItem }`。
重复订阅返回 409 与 `{ "error": "已经订阅过这部作品" }`。

### `PATCH /api/subscriptions/:id`
请求体是 SubscriptionItem 的任意子集，返回 `{ "item": SubscriptionItem }`。

### `DELETE /api/subscriptions/:id`
返回 `{ "ok": true }`。

订阅检查的匹配规则：只用 TMDB 的原名搜索，原名搜不到才用本地化名回退一次；
两次结果都要过片名闸（原名按有效词命中率 ≥60%，中文按字符命中率 ≥50%），
电影还要过年份闸（候选名里的年份与所订阅年份相差超过一年即排除）。
不匹配的候选一律不下发，检查结果里只报告「已检查 N 条候选」。
电视单集要求候选自带同一季且集号包含目标集，整季包要求声明同一季或合集。
候选已在下载列表中时记为「已在下载列表中：<片名>」，不算检查失败。

### `POST /api/subscriptions/:id/check`
立即执行一次检查，返回
```json
{ "ran": true, "found": 3, "added": ["S06E05"], "message": "发现 1 个新剧集，已加入下载" }
```

### `GET /api/subscriptions/export`
`Content-Type: application/json`，`Content-Disposition: attachment; filename="wanspilot-订阅.json"`。
前端用普通 `a[download]` 触发，平台的文件选择器会接管并让用户保存到网盘。

### `POST /api/subscriptions/import`
请求体 `{ "items": [ /* SubscriptionItem 子集 */ ] }` 或 `{ "json": "<文件原文>" }`。
返回 `{ "imported": 2, "skipped": 1 }`。

## 7. 整理、日历与运维

### `GET /api/organizer/status`、`POST /api/organizer/run`
整理状态与手动整理。自动整理打开后，任务下完会按「片名 (年份)/」归档，
可选写 `.nfo` 与 `poster.jpg`（Jellyfin / Emby 直接识别）。优先硬链接，跨盘复制；始终保留 qB 原文件，样本只跳过。重复执行通过 inode / 内容校验避免重复归档。

`GET /api/organizer/preview`：只读预演，不创建目录或文件。返回 `{ "reports": [...] }`。
每项报告含 `planned`（source / target 列表）、`linked`、`copied`、`existing`、`errors`、`skipped` 等字段；`moved` 为兼容旧客户端保留的成功归档计数，并不表示删除原件。

### `GET /api/calendar?month=YYYY-MM`
更新日历：`{ "month": "2026-10", "days": [{ "date": "2026-10-08",
"items": [{ "subscriptionId": "sub_x1", "tmdbId": 106379, "type": "tv", "title": "流人",
"posterPath": "/x.jpg", "season": 6, "episode": 4, "airDate": "2026-10-08", "status": "downloaded" }] }],
"total": 5, "missing": 1 }`。`status` 取 `downloaded`（已完成）、`downloading`（下载中）、`missing`（已到播出日期、待补集）或 `upcoming`（未来未播出）。已完成 / 下载中优先于日期判断。

响应额外包含 `today`（服务端本地日期）、`downloaded`、`downloading`、`upcoming` 计数及 `warnings` 数组；部分 TMDB 失败时返回已获取结果和警告，不冒充完整空日历。非法月份（如 `2026-13`）返回 400。前端按同一订阅、季和日期合并多集展示，接口仍返回逐集记录。

### `GET /api/health/report`
运行状况看板：TMDB 连通性、各索引源延迟、磁盘剩余与配额、任务统计。

### `GET /api/capacity`
`{ "freeBytes": 3855835684864, "quotaGB": 0, "downloadDir": "/downloads", "source": "qbittorrent" }`

### `POST /api/subscriptions/:id/upgrade`、`DELETE /api/subscriptions/:id/upgrade`
降档下载后如果发现更好的版本，订阅条目里会出现 `upgrade` 字段；
`POST` 表示替换（把更好的版本加入下载），`DELETE` 表示忽略这次提示。

## 8. 日志

### `GET /api/logs?lines=200`
`Content-Type: text/plain; charset=utf-8`，返回最近若干行运行日志。

## 9. 前端约定

- 单页应用，无构建步骤：`content/web/index.html` + `styles.css` + `app.js` + `opening.css` + `opening.js` + `cinema.css`，由后端静态托管。
- 启动开场动画：`opening.css` / `opening.js` 铺一层星空，logo 与字标按 linear 时间轴出现，
  约 2.95 秒后淡出 0.5 秒并移除；点画面、按 Enter、Esc 或空格立即结束，
  `prefers-reduced-motion` 下只留一帧静态画面然后淡出。动画里没有跳过按钮，跳过只靠点击与按键。
  同一次会话里刷新页面不重播（`sessionStorage` 里的 `wanspilot.openingSeen`）。
- 顶部固定导航：影视墙、搜索、订阅、日历、任务、设置。
- 路由用 `location.hash`：`#/home`、`#/search`、`#/subscribe`、`#/calendar`、`#/tasks`、
  `#/settings`、`#/detail/movie/550`、`#/detail/tv/123`、`#/resources/tv/123`。
- 搜索页：搜索框在页头右上角，下面依次是「类型 / 风格 / 语种 / 年份 / 评分 / 排序」筛选与结果格；
  结果栏每行 8 张（窄屏自适应），末行会撑满宽度；翻页按钮与 `第 x / N 页` 一起靠右。
  关键词搜索时筛选区只留类型行。
- 订阅页只列自己订阅了什么，顶部两档「电影 / 剧集」并各自带条数，`#/subscribe?type=movie|tv`
  可直达某一档；不传 `type` 时落在有内容的那一档。每张订阅就是一张海报卡（片名 + 状态），
  操作与详情在**右击菜单**里（触屏设备用海报右上角的三个点，键盘可用回车）：
  立即检查 / 编辑 / 暂停启用 / 删除。
- 日历页只放更新日历：按月历方格排，每天更新哪些直接以海报出现在日期框里，
  海报角标写 `S02E03`，绿框是已下载、红框是漏掉的，今天带「今天」标记；点海报进详情页。
- 影视墙的横向滑动条：两端渐隐 + 悬停出现的左右按钮，滚动条收细。
- 页面切换性能：影视墙、搜索、详情、订阅、日历的渲染结果连同事件处理与滚动位置一起留在内存
  （`viewStash`），回到同一页直接贴回 DOM，不重打接口也不重建节点；订阅或设置变更会作废相关快照。
  数据缓存 30 分钟，订阅状态 30 秒。
- 海报卡右侧含两个按钮：搜索（进 `#/resources/...` 找资源）与订阅（`POST /api/subscriptions`）。
  已订阅时订阅按钮常显且为实心收藏图标，再点一次直接取消订阅（只删订阅记录，已下载的文件与正在下载的任务都不动）。
- 首次打开若 `GET /api/settings` 的 `tmdbApiKey` 为空，直接把用户带到「设置」页并高亮 Key 输入框。
- 网盘文件选择器用官方 Web Component `<lzc-file-picker>`，脚本从
  `./vendor/lzc-file-pickers.umd.js` 加载。用途有三处：选择下载目录（`type="directory"`）、
  导入 .torrent（`type="file"`）、订阅导出（走平台自动拦截）。
- 平台会在 URL 上带 `?lzcOpenFile=<文件地址>`（网盘右键「用 wanspilot 打开」），
  前端检测到后打开「导入种子」对话框并预填该地址。
- 界面语言中文，`<html lang="zh-CN">`。
- 不引用任何外域资源：字体、图标、脚本全部本地。
