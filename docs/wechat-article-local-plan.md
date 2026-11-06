# 公众号排版工具 · 纯本地化落地与实现记录

> 本文记录把《Markdown 转微信公众号文章头部工具与落地技术深度分析》的调研结论，
> 落到 LocalForge（纯浏览器端工具箱）时的边界、取舍、架构、**完整能力矩阵**与验证结果。
> 目标读者：项目维护者与后续贡献者。
>
> **状态：已落地**。Phase 1 完成纯本地内核与工具页集成，Phase 2 完成扩展规划的全员实现；
> 每一项能力都有可运行代码，并由单测 / 浏览器端 e2e 覆盖。

---

## 0. 结论先行

调研得到的核心判断是：这个赛道的本质**不是**「把 Markdown 转成好看的 HTML」，而是
**在编译期生成一份「天生抗微信清洗」的 HTML**——微信后台会剥掉 `class` / `id` / `<style>` /
外部 CSS / `position` / `var()` / 外链资源，任何依赖运行时 CSS 的方案都会在粘贴后失真。

因此落地方案没有做成云端发布器或 API 客户端，而是做成 LocalForge 里的一个**纯浏览器工具页**：

- 两层**零依赖、纯函数**内核：`src/lib/wechat.js`（AST / 样式映射 / 微信渲染 / 诊断）与
  `src/lib/wechat-extra.js`（多端调度 / 模板 / 主题 IO / 元数据 / 离线发布包 / 纯 JS ZIP）；
- 一个纯本地视图 `src/views/WechatArticle.vue`（编辑、预览、图片本地化、规范自检、批量、草稿）；
- **不引入任何新 npm 依赖**，不调用微信接口，不上传文件，不拉取 CDN，不联网；
- 发布动作（粘贴到公众号后台）始终由用户手动完成。

产物：可粘进公众号编辑器的 HTML（富文本剪贴板 / 下载 `.html`），以及可选的校验报告、
离线发布包 ZIP、批量结果 ZIP。**发布始终不由程序代劳**。

---

## 1. 边界：纯本地化的硬约束

LocalForge 的隐私模型是「零上传、零后端、零追踪」。这直接决定了本工具**不做什么**：

| 环节 | 云端 / API 发布类工具 | 本工具（LocalForge） |
|---|---|---|
| 渲染 | Node/服务端 + `marked` + `juice` + `highlight.js` | 浏览器内两层纯 JS 内核，零构建期依赖 |
| 图片 | 调 `/cgi-bin/media/uploadimg` 换成 `mmbiz.qpic.cn` | 本地图片 → `data:image/...;base64`；可压缩、粘贴截图、SVG→PNG；或 `images` 映射；或已是微信域的 URL |
| 外链 | 保留或 POST 给微信 | 微信目标一律折叠为文末「参考资料」；通用目标保留外链 |
| 公式 / 图表 | KaTeX / Mermaid → SVG | **不渲染**；提供 SVG→Canvas→PNG 纯本地栅格化，建议先截图为 PNG 再插入 |
| 合规校验 | 官方 `verify-article-structure-spec`（依赖 puppeteer 真实布局测量） | 静态可检测子集 + code 化诊断 + 5 语言文案 |
| 发布 | `draft/add` 写入草稿箱，需 `access_token` | **不做**，只写 `text/html` 到剪贴板 / 下载 / 离线包 |
| 网络请求 | 必须有 | **零**（除站点自身静态资源） |

一句话：**用「编译期兼容」换「运行时零依赖」，用「用户手动粘贴」换「零接口调用」**。

---

## 2. 承接调研结论：站在巨人肩膀上的取舍

| 调研结论 / 主流做法 | 代表项目 | 本实现的选择 | 为什么这样取舍 |
|---|---|---|---|
| CSS 内联化 | `mdnice`：`主题 CSS + juice`；`doocs/md`：CSS 变量 + 自研 `cssProcessor` + juice patch | JS `styleMapping` **直接生成** `style="..."` | `juice` 依赖 DOM/解析树且会引入新依赖；本项目要「纯函数内核可在 Node 直接单测」，故在编译期就只产出白名单属性 |
| 主题系统 | CSS 变量 + `var()` 展开 | 主题对象 → 内联值；支持自定义主题 JSON 导入导出 | 微信会清洗 `var()`；编译期展开最可靠，主题切换只是一次重算 |
| 文本节点 `<span leaf="">` | 官方编辑器插件规范 | 微信目标统一包裹 | 遵守规范，避免粘贴后被重排丢样式 |
| 外链处理 | 部分工具转脚注 | 微信目标折叠为文末参考资料 | 微信正文仅放行 `mp.weixin.qq.com` |
| 代码高亮 | `highlight.js` | 轻量 tokenizer（注释 / 字符串 / 数字 / 关键词） | 零依赖；换行转 `<br>`、行首空格转 `\u00A0`、`<pre>` 带 `overflow-x:auto` |
| Mac 风格代码块三圆点 | 常见内联 SVG（含 `defs`/`marker`/`id`） | 手写内联样式的圆点 | 微信会过滤 SVG `marker`/`defs`/`id` |
| 结构化排版模块 | `md2wechat` 的 `:::hero` / `:::cards` | 14 个模块：`hero` / `masthead` / `cards` / `metrics` / `toc` / `cta` / `verdict` / `quote-card` / `notice` / `checklist` + 新增 `timeline` / `compare` / `steps` / `code-title` | 覆盖常见图文结构；未知模块降级为普通段落并 code 化告警，不静默吞内容 |
| 合规校验 | 官方校验器（puppeteer 测真实布局） | 静态子集 + 明确的「仍需手机预览」提示 | 纯本地、零依赖；不伪造自己没有的测量能力 |
| 输出 | `ClipboardItem` + `text/html` | 同，外加 `copy` 事件 + `document.execCommand('copy')` 回退 | 必须同时写 `text/plain`，否则会粘出 HTML 源码 |

---

## 3. 三层解耦架构与数据流（Phase 2 重构）

```
Markdown（+ Frontmatter）
   │  parseDocument() = parseFrontmatter() + parseBlocks()
   ▼
AST（块级节点数组 + meta）
   │
   ├─ target=wechat ─→ buildStyleMapping(theme, options)
   │                     └→ compileWechatAst(ast, opts)  → 全内联 HTML + previewHtml + plain + report
   │
   └─ 其他 target ───→ renderGeneric(ast, target, options) → 语义 HTML（保留外链 / language-* class）
   ▼
renderDocument(ast, { target, styleMapping, options })     ← 统一入口
   ▼
validateWechatHtml(html) → { ok, errors, warnings, issues, stats }
   ▼
视图层：主题 / 平台 / 模板 / 字号 / 行高 · 图片本地化 · 元数据校对 · 规范自检 ·
        复制 · 下载 · 报告 · 发布包 · 批量 · 草稿 · NextSteps 站内工作流
```

| 层 | 实现 | 职责 | 可测性 |
|---|---|---|---|
| AST 层 | `parseDocument()` / `parseBlocks()` / `parseFrontmatter()` | 把 Markdown 解析成块级节点，不含任何样式 | 纯函数，Node 直接跑 |
| 样式映射层 | `buildStyleMapping()`（= `buildStyles`）/ `cssText()` / `sanitizeTheme()` | 主题 + 选项 → 白名单内联样式表 | 纯函数，可注入覆盖 |
| 渲染层 | `compileWechatAst()` / `renderGeneric()` / `renderDocument()` | AST → 目标 HTML；统一签名见下 | 纯函数，Node 直接跑 |

统一签名：

```js
export function renderDocument(ast, { target = 'wechat', styleMapping, options = {} } = {})
```

关键设计决策：

- **`styleMapping` 可外部注入**：`compileWechatAst` 内部用 `{ ...base, ...opts.styleMapping }` 合并，
  为自定义主题 / 多端皮肤留扩展点，无需改内核。
- **微信目标永不经过通用渲染器**：`RENDER_TARGETS` 中 `wechat` 委托 `compileWechatAst()`，
  保证抗清洗产物字节级稳定；单测断言 `renderDocument(ast, {target:'wechat'}).html === renderWechatArticle(md).html`。
- **内核不碰 `document` / `window`**：`tests/unit/*.test.mjs` 用 Node 原生 `node:test` 直接跑，
  不需要浏览器，也不需要 jsdom。
- **显式选项优先于 Frontmatter**：`theme` 解析顺序是 `opts.theme || meta.theme || DEFAULT_THEME`。
  视图总是把当前选中的主题传进来；若让 frontmatter 优先，带 `theme:` 的文档在 UI 上切换主题会
  「点了没反应」（此坑由 e2e 暴露，已加回归单测）。

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

诊断结果同时提供两代契约，旧调用方不回归：

```js
issues:  [{ code, params, level }]   // 新增：结构化，供视图按语言翻译
errors:  string[]                     // 兼容：由 deriveIssues() 派生
warnings: string[]
```

`ISSUE_MESSAGES` 为每个 code 内置 5 语言文案，`describeIssue(issue, locale)` 负责插值翻译，
`deriveIssues(issues, locale)` 派生旧字符串字段。

---

## 5. 能力矩阵（全员落地）

### P0 · 诊断与数据可靠性

| 能力 | 实现位置 | 关键 API | 验证 |
|---|---|---|---|
| 诊断 code 化 + 5 语言 | `wechat.js` | `ISSUE_MESSAGES` / `describeIssue()` / `deriveIssues()` | 单测（每个 code 五语言齐全且无空文案）+ e2e |
| 自定义主题导入 / 导出 | `wechat-extra.js` + 视图 | `THEME_SCHEMA_VERSION = 1` / `importTheme()` / `exportTheme()` / `exportThemeBundle()` / `sanitizeTheme()` | 单测，含 CSS 注入拦截 |
| 图片压缩 / 粘贴截图 / SVG→PNG | `WechatArticle.vue` | `compressDataUrl()` / `onPaste()` / `svgToPng()` | e2e 入口断言 |
| 元数据校对 | `wechat-extra.js` | `checkMetadata()`，6 类 code 化告警 | 单测 + e2e（4 项统计） |

主题安全：`sanitizeTheme()` 只放行合法 `hex` / `rgb` / `rgba`，非法值回退默认并产生
`theme-bad-color` 警告，防止 `red;position:fixed;background:url(...)` 被注入 `style=""`。

### P1 · 渲染与结构化能力

| 能力 | 实现位置 | 关键 API | 验证 |
|---|---|---|---|
| 三层解耦 | 两个内核 | `renderDocument(ast, { target, styleMapping, options })` | 单测：wechat 目标产物字节一致 |
| 多端输出 | `wechat-extra.js` | `RENDER_TARGETS`：`wechat` / `zhihu` / `juejin` / `feishu` / `email` | 单测 + e2e（知乎 ↔ 微信互切） |
| 文章模板 | `wechat-extra.js` | `WECHAT_TEMPLATES`：`blank` / `tutorial` / `weekly` / `review` | 单测 + e2e（应用模板） |
| 结构化模块扩容 | `wechat.js` | 新增 `timeline` / `compare` / `steps` / `code-title`；`compare` 首行作表头、支持任意列 | 单测（第 3 列不丢失） |
| 校验报告导出 | 视图 | `reportText()` / `doReport()` | e2e 按钮断言 |
| 公式 / 图表纯本地 PNG 路线 | 视图 | SVG → Canvas → PNG | 说明性限制见第 9 节 |

多端差异（实测 `WECHAT_SAMPLE`）：

| 目标 | 产物长度 | `<span leaf="">` | `<a href>` | 说明 |
|---|---|---|---|---|
| `wechat` | 8598 | 52 | 0 | 外链折叠为文末参考资料，全内联样式 |
| `zhihu` / `juejin` | 1488 | 0 | 2 | 语义 HTML，保留外链与 `language-*` class |
| `email` | 3515 | 0 | 2 | 保守内联样式，不依赖 class |

### P2 · 工作流与离线交付

| 能力 | 实现位置 | 关键 API / 位置 | 验证 |
|---|---|---|---|
| 站内工作流串联 | `workflow.js` + `NextSteps.vue` | `/ocr`、`/qr-code`、`/text` → `/wechat-article`；`/wechat-article` → `/zip-compress`、`/text`；新增 `wf.toWechat` 5 语言标签 | 单测（FLOWS 目标可达 / 标签齐全）+ 一致性护栏 |
| 离线发布包 | `wechat-extra.js` | `buildStoreZip()`（纯 JS store ZIP）+ `publishPackageFiles()`：`article.md` / `article.html` / `report.txt` / `meta.json` / `images/1.png` / `README.txt` | 单测 + 系统 `unzip -t` 交叉验证 |
| 批量排版 | 视图 | `doBatch()`：串行渲染 `.md` → `.html` → ZIP | e2e 按钮断言 |
| 草稿历史 | 视图 | `localStorage` key `localforge.wechat.drafts`，最多 10 份 | e2e（保存后出现可恢复条目） |
| PWA 离线声明 | `public/sw.js` | `OFFLINE_NATIVE_TOOLS = ['/wechat-article']`；`CORE_STATUS` 增加 `offlineNative` 字段 | `offline` 套件 |

零依赖 ZIP 的说明：不引入 `@zip.js` / `libarchive` / WASM，手写本地 ZIP 头、CRC32、
central directory 与 EOCD，采用 store（不压缩）模式；`zipEntry()` 支持 string / `Uint8Array` /
DataURL。图片文件名改为纯序号，规避旧解压工具对中文名的 mojibake。

---

## 6. 输入输出契约

`src/lib/wechat.js` 主要导出（19 个）：

| 符号 | 说明 |
|---|---|
| `renderWechatArticle(md, opts)` | 主入口，等价于 `compileWechatAst(parseDocument(md), opts)` |
| `parseDocument(md)` / `parseFrontmatter(md)` / `parseBlocks(body)` | AST 解析层，单独导出便于测试 |
| `compileWechatAst(ast, opts)` | AST → 微信目标产物 |
| `buildStyleMapping` / `cssText` / `sanitizeTheme` | 样式映射层 |
| `validateWechatHtml(html, opts)` | 静态合规校验，返回 `{ ok, errors, warnings, issues, stats }` |
| `describeIssue` / `deriveIssues` / `ISSUE_MESSAGES` | 诊断本地化 |
| `WECHAT_THEMES` / `getTheme(id)` / `DEFAULT_THEME` | 主题清单（4 套内置，`getTheme` 支持自定义主题对象） |
| `ALLOWED_CSS` / `DENIED_TAGS` / `escapeHtml` / `WECHAT_SAMPLE` | 常量与工具 / 示例文档 |

`src/lib/wechat-extra.js` 主要导出（20 个）：

| 符号 | 说明 |
|---|---|
| `RENDER_TARGETS` / `getTarget` / `targetLabel` / `targetHint` | 多端目标元数据（含 5 语言名称与提示） |
| `renderDocument(ast, opts)` / `renderMarkdownTo()` | 统一渲染入口 |
| `WECHAT_TEMPLATES` / `getTemplate` / `templateLabel` | 模板系统（含 5 语言名称） |
| `THEME_SCHEMA_VERSION` / `exportTheme` / `exportThemeBundle` / `importTheme` | 主题 IO（带 schema 版本与校验） |
| `checkMetadata(md)` | 元数据校对，返回字数 / 阅读时长 / 图片数 / 外链数 + code 化告警 |
| `zipEntry` / `buildStoreZip(files)` / `publishPackageFiles(...)` | 纯 JS ZIP 与离线发布包 |
| re-export：`describeIssue` / `deriveIssues` / `ISSUE_MESSAGES` | 便于视图单点引入 |

`opts` 字段：`theme`、`fontSize`、`lineHeight`、`radius`、`smartSpace`、`footnoteLinks`、
`macStyle`、`images`（`{ 文件名: { src, w, h } }`）、`styleMapping`。

`report.errors` 非空时，视图会**阻止复制**（避免把带外链图片 / 违规结构的 HTML 粘进公众号）。

---

## 7. LocalForge 集成点清单

| 文件 | 改动 | 对应护栏 |
|---|---|---|
| `src/lib/wechat.js` | 零依赖内核（833 行，三层解耦 + code 化诊断） | 单测 16 项 |
| `src/lib/wechat-extra.js` | 扩展层（566 行，多端 / 模板 / 主题 IO / 元数据 / ZIP） | 单测 25 项 |
| `src/views/WechatArticle.vue` | 纯本地视图（569 行，接入全部新能力） | 渲染冒烟 + e2e 16 项 |
| `src/router/index.js` | `views` 懒加载 + `fileToPath` 加 `/wechat-article` | 断言 B / C |
| `src/lib/nav.js` | NAV 加一条，`group.dev`、含 `titleKey`/`shortKey` | 断言 A / B |
| `src/lib/i18n.js` | 5 语言 `nav.wechatArticle` / `wechatArticleShort` | 断言 E |
| `src/lib/formats.js` | 首页「开发者工具」加一张卡片（第 46 张） | 断言 D / G |
| `src/lib/i18n.home.*.js` | 5 语言首页卡片 `wechatArticle` 标题与描述 | 断言 G |
| `src/lib/i18n.views.js` | 5 语言 × **73** 个 `views.wechatArticle.*` UI 词条（37 → 73） | 断言 E |
| `src/components/SelfTestPanel.vue` | `VIEW_ROUTES` 加 `/wechat-article` | 断言 C |
| `src/lib/workflow.js` | 3 个入站 + 2 个出站「下一步」，新增 `wf.toWechat` 5 语言标签 | 单测 + 断言 B |
| `public/sw.js` | 声明零 WASM 内核、懒加载 chunk、首次访问后离线可用 | `offline` 套件 |
| `scripts/check-consistency.mjs` | 补扫 `i18n.views.js`（修复既有漏项） | 断言 E |
| `tests/unit/wechat.test.mjs` | 16 个内核单测 | `pnpm test:unit` |
| `tests/unit/wechat-extra.test.mjs` | 25 个扩展层单测 | `pnpm test:unit` |
| `_e2e_wechat.mjs` + `tests/suites.mjs` | 浏览器端 e2e（core 组，16 项） | `pnpm test:e2e:wechat` |
| `tests/unit/formats.test.mjs`、`tests/README.md`、`_e2e_i18n.mjs` | 卡片数 45 → 46 同步 | 单测 / 文档 |
| `README.md` | 功能矩阵 / 工程结构 / 隐私 / 路线图 / e2e 命令 | — |

> 顺带修复了两处**项目既有问题**（经干净 HEAD 对照确认，与本次功能无关）：
> 1. 护栏的 `i18nSrcs` 漏扫 `i18n.views.js`，导致断言 E 一直误报大量 `views.*` 词条缺失；
> 2. `tests/unit/text.test.mjs` 里 `'\d+'` 少写一个反斜杠，实际 pattern 变成 `d+`，该测试常年失败。

---

## 8. 验证矩阵与结果

| 验证项 | 命令 | 结果 |
|---|---|---|
| 一致性护栏 | `node scripts/check-consistency.mjs` | **8/8 通过**（NAV 24 / 视图 24 / 冒烟 24 / 卡片 46；校验 298 个 key：导航 47 + 视图 251） |
| 单元测试 | `node tests/run.mjs unit` | **83/83 通过**（wechat 16 + wechat-extra 25 + 既有 42） |
| 生产构建 | `pnpm build` | 通过；`WechatArticle` 独立懒加载 chunk 70.27 kB / gzip 26.13 kB，**不进首屏** |
| 体积门禁 | `node scripts/check-bundle-size.mjs` | 全部预算达标（应用代码 raw 3.25 MB / gzip 1.09 MB；WASM 内核 76.18 MB 单独计） |
| 公众号 e2e | `pnpm test:e2e:wechat` | **16/16 通过**（清单见下） |
| 多语言 e2e | `pnpm test:e2e:i18n` | 通过（5 语言切换与本地化不变量，含首页 46 卡片） |
| 完整 core 组 | `node tests/run.mjs e2e --group core` | **8/10**：`qrcode` / `progress` 失败，属既有环境问题，见下 |
| 纯 JS ZIP 交叉验证 | `unzip -t` 发布包 | `No errors detected`，结构正确 |

公众号 e2e 的 16 项断言：

1. 页面挂载：视图标题与文档标题均已本地化且无 key 泄漏
2. 预览 iframe 已注入编译产物
3. 可提取文章片段（编译产物）
4. 使用内联样式且文本节点包进 `span[leaf]`
5. 文章片段无 `class` / `id` / `var()` / `font-family` / `position` / `<style>`
6. 规范自检 0 错误
7. 帮助说明与「复制到公众号 / 下载 HTML」入口齐全（13 个功能按钮）
8. 切换主题后预览重新编译
9. 编辑 Markdown 后预览实时更新
10. 切换输出平台到知乎后走通用渲染器（无 leaf 包裹且保留外链）
11. 切回微信公众号目标后恢复内联 + leaf 结构
12. 应用文章模板后 Markdown 被替换为模板内容
13. 元数据校对区展示字数 / 阅读时长 / 图片 / 外链统计
14. 保存草稿后本地出现可恢复条目（localStorage）
15. 隐私不变量：无任何跨域网络请求
16. 页面无控制台 / 运行时错误

**关于完整 core 组的 2 项失败**：`qrcode`（`Waiting failed: 10000ms exceeded`）与
`progress`（`A5：出现阶段进度组件 — missing`）在**干净 HEAD 工作树 + 相同构建资源**下同样失败，
是项目既有的沙箱 WASM / 环境依赖问题，与本次改动无关——两者都不经过
`wechat.js` / `wechat-extra.js` / `WechatArticle.vue`，本轮改动文件清单也不含它们。
其余 8 个套件（`i18n` / `layout` / `features` / `doc` / `wechat` / `batch` / `imagepro` / `offline`）全部通过。

e2e 里的「**零跨域网络请求**」是隐私不变量的关键断言：页面从加载到交互（含本轮新增的
平台切换、模板应用、草稿保存等），所有 HTTP(S) 请求都必须同源；这直接证明工具没有偷调
微信接口或拉 CDN。

---

## 9. 已知限制（诚实清单）

1. **静态校验 ≠ 真实布局测量**。真实的大屏/窄屏差异、叠字检测需要浏览器布局引擎；
   本工具不伪造该能力，因此「0 错误」后仍应手机预览。
2. **图片必须本地化**。外链图片会报错并阻止微信目标复制（纯本地化的有意约束）；
   若文章已发布过，可手动把 `mmbiz.qpic.cn` 的 URL 写进 Markdown。
3. **不生成公式 / Mermaid / 图表**。不引入 KaTeX、Mermaid，不拉取任何 CDN；
   视图提供 SVG→PNG 栅格化，但只是转换已有 SVG，不负责渲染公式。
4. **剪贴板优先 Chrome / Edge**。`ClipboardItem` 不是所有浏览器都完整支持；
   已提供 `copy` 事件回退，以及「下载 HTML 后全选复制」的最终兜底。
5. **草稿与自定义主题仅存本机 `localStorage`**，清缓存即失，不跨设备同步（有意的隐私取舍）。
6. **通用目标不做平台专属样式适配**。`zhihu` / `juejin` / `feishu` / `email` 输出语义 HTML，
   不负责发布，也不保证各平台编辑器 100% 保真；只有 `wechat` 目标是抗清洗产物。
7. **发布包 ZIP 用 store 模式**（不压缩）以保证零依赖；图片文件名为纯序号，
   规避旧解压工具对中文名的 mojibake。
8. **不做发布**。`draft/add`、素材上传、`access_token` 全部不在范围内。

---

## 10. 明确不做

- 为对齐官方校验器而引入 puppeteer / 服务端真实布局测量；
- `draft/add`、素材上传、`access_token` 等任何微信接口调用；
- CDN 版 KaTeX / Mermaid / highlight.js；
- 账号体系、云同步、草稿云端备份、遥测 / 分析；
- 把 `class`、外部 CSS、`<style>` 重新塞回微信目标产物；
- 任何会让「零依赖、纯浏览器、零联网」失效的便捷功能。

以上每一条都会破坏本工具存在的根本理由。

---

## 11. 剩余可选项（非阻断）

原规划的 P0 / P1 / P2 已全部落地。以下仅记录「还能继续做、但不在本轮范围」的方向：

- 主题可视化编辑器（当前靠 JSON 导入导出）；
- 发布包内容模板自定义；
- 更多平台的专属样式适配（当前为通用语义输出）；
- 公式 / 图表的纯本地栅格化渲染器（当前只做 SVG→PNG 转换）。
