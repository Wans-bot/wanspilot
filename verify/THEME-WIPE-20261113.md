# 主题切换改为「右上到左下」线性扫入（2026-11-13）

## 需求

> 还有个问题就是说黑白主题切换时，太直接了 应该有个动画比如从右上到左下渐变这种

同批一并收口的两项：

- 搜索页年份筛选按最新年份在前；
- 未配置代理时被跳过的索引源在界面上写明原因，而不是静默消失。

## 实现

1. 新增 `.theme-curtain` 幕布：`position: fixed; inset: 0; pointer-events: none;`，颜色取目标主题的底色（暗色 `#0a0a0b` / 亮色 `#f6f4ef`）。
2. `runThemeTransition(commit, next)`：以右上角 `(width, 0)` 为圆心，`clip-path: circle()` 从 0 扩到对角线半径（380ms linear）→ 铺满后执行 `commit()` 真正切换主题 → 幕布再收回到 0（380ms linear）露出新主题。
3. 动画用 WAAPI（`curtain.animate`），结束后立即移除幕布；另有 `THEME_WIPE_MS * 2 + 240` 的兜底定时器，避免异常情况下幕布滞留。
4. 减少动效偏好（`prefers-reduced-motion: reduce`）下直接切主题，`cursor`、点击都能立刻响应；幕布 `pointer-events: none`，扫入过程中页面照常可点。
5. 保留 `html.theme-fade` 作为颜色过渡兜底（0.4s linear），使幕布边缘外的颜色也不会硬跳。

### 为什么不用 View Transition

第一版用 `document.startViewTransition()` + `::view-transition-new(root)` 的 `clip-path` 波前。真机验收发现两个硬问题：

- 过渡期间 Chrome 会对整页做快照，`document.elementFromPoint()` 在按钮位置返回 `html`，**用户点击会被吞掉**；给 `::view-transition*` 加 `pointer-events: none` 无效。
- 连续切换后偶发 `html:active-view-transition` 一直为真、`theme-wipe` 类不摘除，页面滚动与点击被冻结（浏览器验收里表现为后续 `waitForSelector` 30s 超时）。

因此改为自绘幕布，不依赖 View Transition 生命周期。

## 验证

```bash
npm run check --prefix content                                                    # 通过
npm test --prefix content                                                         # 103/103
WP_CHROME_PATH=/home/wans/opt/chrome-linux64/chrome \
WP_SCREENSHOTS=/home/wans/工程实例/wanspilot-docker/verify/ui-theme-wipe-20261113 \
  npm run test:browser --prefix content                                           # 89 项全过，errors 0
```

浏览器验收新增断言：点击后出现 `.theme-curtain`、`clipPath` 以 `circle(` 开头、主题按钮只有一个图标、扫完后幕布被移除且主题已切换。

截图证据（390×844 手机视口）：

- `verify/ui-theme-wipe-20261113/theme-wipe-mid.png`：右上角一枚亮色圆角弧，正在扫入；
- `verify/ui-theme-wipe-20261113/theme-wipe-late.png`：亮色已铺满大半屏，左下角还剩暗色，方向为右上 → 左下；
- `verify/ui-theme-wipe-20261113/calendar-light-mobile.png`：切换完成后的浅色日历页。

## 已知限制

- 本机到 `share.dmhy.org`、`bt4gprx.com`、`knaben.eu` 均超时（curl exit 28），新增索引源只能在配代理的环境复核可达性。
- 幕布是纯色底 + 圆形裁剪，若将来主题背景引入图片或渐变，需要把幕布背景同步成对应值。
