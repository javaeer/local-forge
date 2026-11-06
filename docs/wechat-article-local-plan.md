# 公众号排版工具 · 纯本地化落地规划

> 本文记录「把上一轮《Markdown 转微信公众号文章头部工具与落地技术深度分析》的调研结论，
> 落到 LocalForge 这个纯浏览器端工具箱」时的边界、取舍、架构与验证结果。
> 目标读者：项目维护者与后续贡献者。

---

## 0. 结论先行

调研得到的核心判断是：这个赛道的本质**不是**「把 Markdown 转成好看的 HTML」，而是
**在编译期生成一份「天生抗微信清洗」的 HTML**——微信后台会剥掉 `class` / `id` / `<style>` /
外部 CSS / `position` / `var()` / 外链资源，任何依赖运行时 CSS 的方案都会在粘贴后失真。

因此落地方案没有做成云端发布器，而是做成 LocalForge 里的一个**纯浏览器工具页**：

- 一个**零依赖、纯函数**的排版内核 `src/lib/wechat.js`，直接生成全内联样式的 HTML；
- 一个纯本地视图 `src/views/WechatArticle.vue`，负责编辑、预览、图片本地化、规范自检与富文本复制；
- **不引入任何新 npm 依赖**，不调用微信接口，不上传文件，不拉取 CDN，不联网；
- 发布动作（粘贴到公众号后台）始终由用户手动完成。

产物只有一个：可粘进公众号编辑器的 HTML（写入剪贴板，或下载为 `.html`）。

---

## 1. 边界：纯本地化的硬约束

LocalForge 的隐私模型是「零上传、零后端、零追踪」。这直接决定了本工具**不做什么**：

| 环节 | 云端 / API 发布类工具 | 本工具（LocalForge） |
|---|---|---|
| 渲染 | Node/服务端 + `marked` + `juice` + `highlight.js` | 浏览器内纯 JS 内核，无构建期依赖 |
| 图片 | 调 `/cgi-bin/media/uploadimg` 换成 `mmbiz.qpic.cn` | 本地图片 → `data:image/...;base64`；或用户提供的 `images` 映射；或已是微信域的 URL |
| 外链 | 保留或 POST 给微信 | 一律折叠为文末「参考资料」，正文不留 `<a href="https://...">` |
| 公式 / 图表 | KaTeX / Mermaid → SVG | **不渲染**：提示用户先用本地工具截图为 PNG 再插入 |
| 合规校验 | 官方 `verify-article-structure-spec`（依赖 puppeteer 真实布局测量） | 静态可检测子集（纯正则，零依赖） |
| 发布 | `draft/add` 写入草稿箱，需 `access_token` | **不做**，只写 `text/html` 到剪贴板 |
| 网络请求 | 必须有 | **零**（除站点自身静态资源） |

一句话：**用「编译期兼容」换「运行时零依赖」，用「用户手动粘贴」换「零接口调用」**。

---

## 2. 承接调研结论：站在巨人肩膀上的取舍

| 调研结论 / 主流做法 | 代表项目 | 本实现的选择 | 为什么这样取舍 |
|---|---|---|---|
| CSS 内联化 | `mdnice`：`主题 CSS + juice`；`doocs/md`：CSS 变量 + 自研 `cssProcessor` + juice patch | JS `styleMapping` **直接生成** `style="..."` | `juice` 依赖 DOM/解析树，且会引入新依赖；本项目要「纯函数内核可在 Node 直接单测」，故在编译期就只产出白名单属性 |
| 主题系统 | CSS 变量 + `var()` 展开 | 主题对象（`WECHAT_THEMES`）→ 内联值 | 微信会清洗 `var()`；编译期展开最可靠，且主题切换只是一次重算 |
| 文本节点 `<span leaf="">` | 官方编辑器插件规范 | 文本节点统一包裹 | 遵守规范，避免粘贴后被重排丢样式 |
| 外链处理 | 部分工具转脚注 | 同：折叠为文末参考资料 | 微信正文仅放行 `mp.weixin.qq.com` |
| 代码高亮 | `highlight.js` | 轻量 tokenizer（注释 / 字符串 / 数字 / 关键词） | 零依赖；换行转 `<br>`、行首空格转 `\u00A0`、`<pre>` 带 `overflow-x:auto` |
| Mac 风格代码块三圆点 | 常见内联 SVG（含 `defs`/`marker`/`id`） | 手写内联样式的圆点，无 `defs`/`marker`/`id` | 微信会过滤 SVG `marker`/`defs`/`id` |
| 结构化排版模块 | `md2wechat` 的 `:::hero` / `:::cards` / `:::metrics` | 最小 schema：`hero` / `masthead` / `cards` / `metrics` / `toc` / `cta` / `verdict` / `quote-card` / `notice` / `checklist` | 覆盖常见图文结构；未知模块降级为普通段落并告警，不静默吞内容 |
| 合规校验 | 官方校验器（puppeteer 测真实布局） | 静态子集 + 明确的「仍需手机预览」提示 | 纯本地、零依赖；不伪造自己没有的测量能力 |
| 输出 | `ClipboardItem` + `text/html` | 同，外加 `copy` 事件 + `document.execCommand('copy')` 回退 | 必须同时写 `text/plain`，否则会粘出 HTML 源码 |

---

## 3. 架构分层与数据流

```
Markdown（+ Frontmatter）
   │  parseFrontmatter → { meta, body }
   ▼
parseBlocks(body)   ← 自研增强块级解析（不复用 docconvert.js：它顶层依赖 pdf-lib）
   │  标题 / 段落 / 列表 / 任务列表 / 引用 / GFM Alert / 表格 / 代码块 / 图片 / 脚注 / :::module
   ▼
renderBlock(b, ctx, S)   ← S = buildStyles(theme, options)，样式全部是白名单内联值
   ├─ renderInline：粗斜体 / 行内代码 / 链接(→参考资料) / 图片(本地化 DataURL) / XSS 转义
   ├─ highlightCode：轻量 tokenizer，换行与缩进做微信适配
   └─ 结构化模块：hero / cards / metrics / toc / cta / ...
   ▼
组装 <section style="...">…</section> + 文末参考资料
   ▼
validateWechatHtml(html)  → { ok, errors, warnings, stats }
   ▼
renderWechatArticle() 返回 { html, previewHtml, plain, report, stats, meta, title }
   ▼
视图层：iframe 预览 · 主题/字号/行高 · 图片本地化 · 规范自检 · 富文本复制 · 下载 HTML
```

**内核是纯函数**：不碰 `document` / `window`，因此 `tests/unit/wechat.test.mjs` 可以用 Node 原生
`node:test` 直接跑，不需要浏览器，也不需要 jsdom。

**显式选项优先于 Frontmatter**：`theme` 的解析顺序是
`opts.theme || meta.theme || DEFAULT_THEME`。这条规则是必须的——视图总是把当前选中的主题传进来，
若让 frontmatter 优先，带 `theme:` 的文档在 UI 上切换主题会「点了没反应」（已由回归单测覆盖）。

---

## 4. 微信规范 → 静态可检测项映射

对齐《微信公众平台编辑器插件开发规范》中**可以静态检测**的部分：

| 规范红线 | 内核如何保证 | 校验器是否检出 |
|---|---|---|
| 样式全部写在 `style=""` | `cssText()` 只输出 `ALLOWED_CSS` 白名单属性 | ✅ 无 `class` / `id` / `<style>` |
| 推荐 `<section>` | 根容器与块级元素用 `section` | ✅ 禁止标签白名单 |
| 文本节点用 `<span leaf="">` | 渲染时统一包裹 | ✅ 统计 `span[leaf]` 数量 |
| 禁 `position` / `float` / `z-index` / `grid` / `var()` / `@media` / 动画 | 白名单 + `DENIED_CSS` | ✅ 正则扫描 |
| 不建议自定义 `font-family` | 主题里不含该属性 | ✅ |
| 禁 `height:0` 隐藏文字、固定 px 宽度 | 不生成这类样式 | ✅ |
| `<pre>` 需 `overflow-x:auto` | 代码块固定加上 | ✅ |
| 图片建议 `max-width:100%` + `data-w`、微信域 | 本地图片带 `data-w`；外链图片报错 | ✅ 非微信域链接检出 |
| 正文仅放行 `mp.weixin.qq.com` | 外链转参考资料 | ✅ |
| `line-height < font-size` 叠字 / DOM 嵌套过深 | 行高下限 + 结构约束 | ✅ 深度统计 |

> 静态校验**不等于**真实布局测量（官方校验器用 puppeteer 测大屏/窄屏差异）。
> 因此 UI 在「0 错误」时仍明确提示：去公众号后台做一次**手机预览**。

---

## 5. 输入输出契约

`src/lib/wechat.js` 的主要导出：

| 符号 | 签名 / 说明 |
|---|---|
| `renderWechatArticle(md, opts)` | 主入口。返回 `{ html, previewHtml, plain, report, stats, meta, title }` |
| `validateWechatHtml(html)` | 静态合规校验，返回 `{ ok, errors, warnings, stats }` |
| `cssText(style)` | 把样式对象按 `ALLOWED_CSS` 过滤成 `k:v;k:v` 字符串 |
| `parseFrontmatter(md)` / `parseBlocks(body)` | 解析层，单独导出便于测试 |
| `WECHAT_THEMES` / `getTheme(id)` / `DEFAULT_THEME` | 主题清单（4 套内置主题） |
| `WECHAT_SAMPLE` | 内置示例文档，覆盖刊头、模块、脚注、代码块、外链 |

`opts` 字段：`theme`、`fontSize`、`lineHeight`、`radius`、`smartSpace`、`footnoteLinks`、
`macStyle`、`images`（`{ 文件名: { src, w, h } }`）。

`report.errors` 非空时，视图会**阻止复制**（避免把带外链图片 / 违规结构的 HTML 粘进公众号）。

---

## 6. LocalForge 集成点清单

作为项目里的一个工具页，接入点全部沿用现有约定：

| 文件 | 改动 | 对应护栏 |
|---|---|---|
| `src/lib/wechat.js` | 新增零依赖内核 | 单测直接覆盖 |
| `src/views/WechatArticle.vue` | 新增纯本地视图 | 渲染冒烟测试 |
| `src/router/index.js` | `views` 懒加载 + `fileToPath` 加 `/wechat-article` | 断言 B / C |
| `src/lib/nav.js` | NAV 加一条，`group.dev`、含 `titleKey`/`shortKey` | 断言 A / B |
| `src/lib/i18n.js` | 5 语言 `nav.wechatArticle` / `wechatArticleShort` | 断言 E |
| `src/lib/formats.js` | 首页「开发者工具」加一张卡片（第 46 张） | 断言 D / G |
| `src/lib/i18n.home.*.js` | 5 语言首页卡片 `wechatArticle` 标题与描述 | 断言 G |
| `src/lib/i18n.views.js` | 5 语言 × 37 个 `views.wechatArticle.*` UI 词条 | 断言 E |
| `src/components/SelfTestPanel.vue` | `VIEW_ROUTES` 加 `/wechat-article` | 断言 C |
| `tests/unit/wechat.test.mjs` | 16 个内核单测 | `pnpm test:unit` |
| `_e2e_wechat.mjs` + `tests/suites.mjs` | 浏览器端 e2e（core 组） | `pnpm test:e2e:wechat` |
| `tests/unit/formats.test.mjs`、`tests/README.md`、`_e2e_i18n.mjs` | 卡片数 45 → 46 同步 | 单测 / 文档 |
| `scripts/check-consistency.mjs` | 补扫 `i18n.views.js`（修复既有漏项，见下） | 断言 E |
| `README.md` | 功能矩阵 / 工程结构 / 隐私 / 路线图 / e2e 命令 | — |

> 顺带修复了两处**项目既有问题**（经干净 HEAD 对照确认，与本次功能无关）：
> 1. 护栏的 `i18nSrcs` 漏扫 `i18n.views.js`，导致断言 E 一直误报 107 个 `views.*` 词条缺失；
> 2. `tests/unit/text.test.mjs` 里 `'\d+'` 少写一个反斜杠，实际 pattern 变成 `d+`，该测试常年失败。

---

## 7. 验证矩阵与结果

| 验证项 | 命令 | 结果 |
|---|---|---|
| 一致性护栏 | `node scripts/check-consistency.mjs` | **8/8 通过**（NAV 24 / 视图 24 / 冒烟 24 / 卡片 46） |
| 单元测试 | `pnpm test:unit` | **58/58 通过**（其中内核 16 项） |
| 生产构建 | `pnpm build` | 通过；`WechatArticle` 独立懒加载 chunk ≈ 32 KB / gzip ≈ 13 KB，**不进首屏** |
| 体积门禁 | `node scripts/check-bundle-size.mjs` | 全部预算达标 |
| 公众号 e2e | `pnpm test:e2e:wechat` | 11 项：挂载 / 产物结构硬约束 / 规范自检 / 主题与编辑重编译 / 零跨域请求 / 无控制台错误 |
| 多语言 e2e | `pnpm test:e2e:i18n` | 5 语言切换与本地化不变量 |

e2e 里的「**零跨域网络请求**」是隐私不变量的关键断言：页面从加载到交互，
所有 HTTP(S) 请求都必须同源；这直接证明工具没有偷调微信接口或拉 CDN。

---

## 8. 已知限制（诚实清单）

1. **静态校验 ≠ 真实布局测量**。真实的大屏/窄屏差异、叠字检测需要浏览器布局引擎；
   本工具不伪造该能力，因此「0 错误」后仍应手机预览。
2. **内核诊断文本仍为中文**。`report.errors` / `warnings` 的具体描述由内核生成，未做 i18n；
   界面外壳、按钮、说明、导航、首页卡片已完整 5 语言。
3. **图片必须本地化**。外链图片会报错并阻止复制（纯本地化的有意约束）；若文章已发布过，
   可手动把 `mmbiz.qpic.cn` 的 URL 写进 Markdown。
4. **不渲染公式 / Mermaid / 图表**。不引入 KaTeX、Mermaid，也不拉取任何 CDN；
   请先用本地工具截图为 PNG。
5. **剪贴板优先 Chrome / Edge**。`ClipboardItem` 不是所有浏览器都完整支持；
   已提供 `copy` 事件回退，以及「下载 HTML 后全选复制」的最终兜底。
6. **不做发布**。`draft/add`、素材上传、`access_token` 全部不在范围内。

---

## 9. 后续演进（按优先级）

- [ ] 内核诊断文本 i18n 化（把 `report.errors` 改成结构化 code，由视图层翻译）
- [ ] 主题导入 / 导出（JSON），以及用户自定义主题
- [ ] 图片自动压缩（复用项目现有 `image` 内核，降低 DataURL 体积）
- [ ] 更多结构化模块（时间轴、对比表、引用卡）
- [ ] 把「静态校验」结果导出为可复用的检查报告

> 明确**不做**：为对齐官方校验器而引入 puppeteer / 服务端布局测量——那会破坏
> 「零依赖、纯浏览器、零联网」这条本工具存在的根本理由。
