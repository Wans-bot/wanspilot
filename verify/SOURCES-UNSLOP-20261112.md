# WansPilot 1.5.0 · 资源渠道与界面细节

## 范围与验证环境

独立临时数据、模拟 Torznab/RSS 与 qB 服务、Chromium 桌面/手机、深浅主题；没有修改 NAS 生产配置，没有发起真实站点下载。

## 功能

保留公共源，新增最多 12 个可配置 Torznab/RSS 源，手动搜索和自动订阅共用。支持测试、编辑、启停、移除；原地址/密钥不回显，配置落盘 0600。临时下载标识过期/停用/改配置失效；服务端原样取回 torrent 交给 qB，保留 passkey tracker。RSS 是当前条目搜索，不承诺全站历史覆盖，缺少做种数时仍遵守订阅筛选。

## Unslop 审核与方向

使用 unslop by Damir Sokolovsky (@heydamir)，CC BY 4.0。技能来源 heydamir/unslop 的 skills/unslop，审阅提交 97daa3eb365670ea3f87ed85356cbfcee18105a5，安装位置 ~/.codex/skills/unslop。保留其许可与署名。

产品为 NAS 片库的影视发现、追更与下载编排；气质沉稳、准确、微暖；世界来自暗场影院与家庭片库；丰富度由实际海报/剧照和真实进度承载；统一季集编号、任务状态与上海时间作为细节。属于 polish mode，保留现有品牌、布局与视觉，不引入生成图片或装饰色条。

审核发现：小标签字距过大、标题字重偏重、海报悬停缩放、渠道说明面板与单个卡片过宽、深浅主题圆角变量优先级不一致、原生勾选框突兀。

按九轮处理：
1. 间距：头部与说明用 4px 节奏，渠道卡片 24px 内边距/间隔。
2. 颜色：延续现有中性色与暖金；状态标签收敛。
3. 图标：沿用本地 Lucide，去除渠道标题冗余图标。
4. 文案：明确 Torznab/RSS 能力和配置要求，不虚构资源覆盖。
5. 字体：保留系统中文字体，小标签收紧字距，标题最高 600。
6. 布局：保留页面顺序，单渠道不再撑满整行；手机正常堆叠。
7. 细节：36×22 开关、20×20 勾选框与 44px 点击区，键盘可用；修复浅色主题控制圆角。
8. 视觉：现有 TMDB 图像和本地 SVG；验收使用占位图，报告截图不是实际片库。
9. 动效：移除海报/剧照悬停放大，保留加载反馈与可暂停轮播。

## 官方参考

- Jackett README 的 Torznab API 与 Aggregate Indexers。
- fast-xml-parser docs/v4, v5/2.XMLparseOptions.md。
- unslop SKILL.md、references/signs.md、tokens.md、refs.md、visuals.md 及官方示例图。

## 验收结果

- `npm --prefix content test`：93 项通过，包含 qB 4.x/5.x/legacy 既有回归、新渠道认证/同源保护、配置权限/脱敏、XML 拒绝、体积上限、缓存与失效、原 torrent 文件传递、订阅临时标识与重复任务映射。
- `npm --prefix content run check`：通过。
- `npm --prefix content audit --omit=dev`：0 vulnerabilities；undici 升级到兼容的 7.30.2。
- Chromium：92 项通过，224 组布局组合，浏览器运行于 America/Los_Angeles，页面时间仍为上海。新增渠道 CRUD/测试失败展示、密钥不回填、原生开关键盘 Space、订阅小勾选框、浅色圆角检查通过。
- 截图与结构化结果：`verify/source-channels-v1/`。渠道截图为测试服务；未访问或更改 NAS 生产部署。

渠道测试失败以业务状态展示。Prowlarr/Jackett 中已配置的真实站点及其覆盖率，仍需用户自己的服务和权限；本次未作覆盖保证。
