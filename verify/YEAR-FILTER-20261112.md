# WansPilot 1.4.2 单年筛选验收

日期：2026-11-12（Asia/Shanghai）。

- 改动仅限搜索页年份选项，在“2020 年代”后按升序列出 2020 至上海当前年份（2026），不引入未来年份；原年代选项保留。
- 使用现有 yearFrom/yearTo 区间契约，单年传相同起止年份。后端原有 TMDB discover 对电影映射 primary_release_year，剧集映射 first_air_date_year。
- 浏览器操作实际验证 2021、2022、2023 和当前年按钮发出的请求包含精确起止年份；检查高亮、已选标签、年代选择与重置。
- 后端80项、浏览器81项、深浅主题7视口15页面共210组布局均通过；零浏览器异常。语法和 git diff --check 通过。
- 截图：year-filter-v1/search-specific-years-desktop.png。浏览器使用独立测试后端及 mock 数据，不操作 NAS。
